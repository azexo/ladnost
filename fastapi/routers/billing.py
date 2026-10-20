# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta
from database import get_db
from models import (
    TariffPlan, Subscription, SubscriptionStatus, BillingPeriod,
    Workspace, WorkspaceMember, WorkspaceRole, User
)
from utils import get_current_user
from core.hooks import hooks
from core.i18n import t  # ✅ Импортируем функцию перевода
from models import Payment
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# ==========================================
# --- Схемы Pydantic ---
# ==========================================
class TariffResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    price_monthly: int
    price_yearly: int
    limits_json: Optional[dict] = None
    features_json: Optional[list] = None
    is_public: bool
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True

class SubscriptionResponse(BaseModel):
    id: int
    workspace_id: int
    tariff_plan_id: int
    status: str
    billing_period: str
    started_at: datetime
    expires_at: Optional[datetime] = None
    trial_ends_at: Optional[datetime] = None
    auto_renew: bool
    tariff_plan: Optional[TariffResponse] = None

    class Config:
        from_attributes = True

class ActivateTrialRequest(BaseModel):
    workspace_id: int

# ==========================================
# --- Эндпоинты ---
# ==========================================
@router.get("/tariffs", response_model=List[TariffResponse])
def get_available_tariffs(db: Session = Depends(get_db)):
    """Получить список всех доступных публичных тарифов."""
    tariffs = db.query(TariffPlan).filter(
        TariffPlan.is_public == True,
        TariffPlan.is_active == True
    ).order_by(TariffPlan.sort_order).all()
    return tariffs

@router.post("/trial/activate", response_model=SubscriptionResponse)
def activate_trial(
    data: ActivateTrialRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Активация пробного периода (Trial) для рабочего пространства.
    Доступно только OWNER.
    """
    current_user_id = current_user.id
    
    # 1. Проверяем, является ли юзер владельцем
    membership = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == data.workspace_id,
        WorkspaceMember.user_id == current_user_id,
        WorkspaceMember.role == WorkspaceRole.OWNER
    ).first()
    
    if not membership:
        raise HTTPException(status_code=403, detail=t("billing.only_owner_can_activate_trial"))
    
    # 2. Проверяем, нет ли уже активной подписки
    active_sub = db.query(Subscription).filter(
        Subscription.workspace_id == data.workspace_id,
        Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL])
    ).first()
    
    if active_sub:
        raise HTTPException(status_code=400, detail=t("billing.workspace_already_has_active_sub"))
    
    # 3. Ищем тариф с кодом 'trial' (должен быть заранее создан в БД)
    trial_tariff = db.query(TariffPlan).filter(TariffPlan.code == "trial").first()
    
    if not trial_tariff:
        raise HTTPException(status_code=500, detail=t("billing.trial_tariff_not_configured"))
    
    # 4. Создаем подписку на 14 дней
    now = datetime.utcnow()
    trial_ends = now + timedelta(days=14)
    
    new_subscription = Subscription(
        workspace_id=data.workspace_id,
        tariff_plan_id=trial_tariff.id,
        status=SubscriptionStatus.TRIAL,
        billing_period=BillingPeriod.TRIAL,
        started_at=now,
        expires_at=trial_ends,
        trial_ends_at=trial_ends,
        auto_renew=False
    )
    
    db.add(new_subscription)
    db.commit()
    
    # ✅ Перечитываем запись с eager-загрузкой тарифа для корректной сериализации в Pydantic
    created_sub = db.query(Subscription).options(
        joinedload(Subscription.tariff_plan)
    ).filter(Subscription.id == new_subscription.id).first()
    
    return created_sub

@router.get("/workspaces/{workspace_id}/subscription", response_model=SubscriptionResponse)
def get_workspace_subscription(
    workspace_id: int,
    db: Session = Depends(get_db)
):
    """
    Получить текущую подписку воркспейса.
    """
    # 1. Ищем ЛЮБУЮ последнюю подписку (включая EXPIRED и CANCELED)
    subscription = db.query(Subscription).options(
        joinedload(Subscription.tariff_plan)
    ).filter(
        Subscription.workspace_id == workspace_id
    ).order_by(Subscription.started_at.desc()).first()
    
    # Если подписок в БД вообще нет
    if not subscription:
        raise HTTPException(status_code=404, detail=t("billing.subscription_not_found"))
    
    # 2. Автоматическое обновление статуса, если время вышло (но она еще числится как ACTIVE/TRIAL)
    now = datetime.utcnow()
    if subscription.status in [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE]:
        if subscription.expires_at and subscription.expires_at < now:
            subscription.status = SubscriptionStatus.EXPIRED
            db.commit()
            db.refresh(subscription)
    
    # 3. ГЛАВНОЕ: Если подписка истекла или отменена, отдаем 402 (Payment Required)
    if subscription.status in [SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELED]:
        raise HTTPException(
            status_code=402, 
            detail=t("billing.subscription_expired_or_canceled")
        )
    
    # 4. Если всё хорошо (ACTIVE или TRIAL), отдаем объект подписки
    return subscription

class CheckoutRequest(BaseModel):
    workspace_id: int
    tariff_plan_id: int
    billing_period: BillingPeriod # monthly или yearly
    return_url: str

@router.post("/checkout")
async def create_checkout_session(
    data: CheckoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Проверка прав (только OWNER может инициировать оплату)
    membership = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == data.workspace_id,
        WorkspaceMember.user_id == current_user.id,
        WorkspaceMember.role == WorkspaceRole.OWNER
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=403,
            detail=t("billing.only_owner_can_pay")
        )
    
    # 2. Получаем тариф и считаем сумму
    tariff = db.query(TariffPlan).filter(TariffPlan.id == data.tariff_plan_id).first()
    
    if not tariff:
        raise HTTPException(404, detail=t("billing.tariff_not_found"))
    
    amount = tariff.price_yearly if data.billing_period == BillingPeriod.YEARLY else tariff.price_monthly
    
    # 3. Создаем запись Payment в БД
    new_payment = Payment(
        workspace_id=data.workspace_id,
        user_id=current_user.id,
        amount=amount,
        currency="RUB",
        status="pending",
    )
    
    db.add(new_payment)
    db.commit()
    db.refresh(new_payment)
    
    # 4. ФОРМИРУЕМ ДАННЫЕ ДЛЯ ХУКА
    # ✅ Переводим описание платежа с подстановкой названия тарифа
    payment_payload = {
        "amount": amount,
        "description": t("billing.payment_description", name=tariff.name),
        "return_url": data.return_url,
        "metadata": {
            "type": "subscription", 
            "payment_id": new_payment.id, 
            "workspace_id": data.workspace_id,
            "tariff_code": tariff.code,
            "billing_period": data.billing_period.value
        }
    }
    
    # 5. ВЫЗЫВАЕМ ХУК. Плагины перехватят это и создадут платеж
    try:
        result = await hooks.apply_filters("create_payment_link", payment_payload)
    except Exception as e:
        logger.error(f"Ошибка выполнения хука оплаты: {e}", exc_info=True)
        new_payment.status = "failed"
        db.commit()
        raise HTTPException(500, detail=t("billing.payment_init_error"))
    
    # 6. ОБРАБАТЫВАЕМ РЕЗУЛЬТАТ ОТ ПЛАГИНА
    if not result.get("success"):
        new_payment.status = "failed"
        db.commit()
        # ✅ Передаем ошибку из плагина в качестве аргумента для перевода
        error_msg = result.get('error', t('billing.unknown_error'))
        raise HTTPException(500, detail=t("billing.payment_system_error", error=error_msg))
    
    # Сохраняем данные, которые вернул плагин
    new_payment.external_id = result.get("external_id") 
    new_payment.payment_url = result.get("payment_url")
    db.commit()
    
    return {"payment_url": new_payment.payment_url, "payment_id": new_payment.id}

@router.get("/payments/{payment_id}/status")
def get_payment_status(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    payment = db.query(Payment).filter(
        Payment.id == payment_id,
        Payment.user_id == current_user.id # Защита от перебора ID
    ).first()
    
    if not payment:
        raise HTTPException(404, detail=t("billing.payment_not_found"))
    
    return {
        "status": payment.status, # pending, success, canceled
        "payment_url": payment.payment_url
    }