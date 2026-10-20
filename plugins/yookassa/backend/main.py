# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: LicenseRef-Commercial

import sys
import os

import asyncio
import json
import logging
import traceback
from datetime import datetime, timedelta
from typing import Dict, Any
from fastapi import APIRouter, Request, Depends, HTTPException
from sqlalchemy.orm import Session

from .yookassa_integration import create_payment_data, yookassa_api 

from core.hooks import hooks

from database import get_db
from models import Payment, Subscription, SubscriptionStatus, TariffPlan, BillingPeriod
from analysis.backend.rag_models import Contract, ContractClause
from analysis.backend.anonymous_analysis import background_deep_analysis


import logging
logger = logging.getLogger(__name__)

router = APIRouter()

@hooks.filter("create_payment_link", weight=10)
async def handle_yookassa_payment_creation(payment_request: dict) -> dict:
    """
    Хук для создания платежа через ЮKassa.
    Принимает словарь с параметрами, добавляет в него payment_url и payment_id.
    """
    try:
        logger.info(f"🪝 [Hook] Перехватываем запрос на создание платежа для type={payment_request.get('metadata', {}).get('type')}")
        
        # Вызываем API ЮKassa (логика, которая раньше была в anonymous_analysis.py)
        payment_data = create_payment_data(
            amount=payment_request["amount"],
            description=payment_request["description"],
            return_url=payment_request["return_url"],
            metadata=payment_request["metadata"]
        )
        
        yookassa_response = await yookassa_api.create_payment(payment_data)
        
        # "Прогоняем" результат через фильтр, добавляя нужные поля
        payment_request["payment_url"] = yookassa_response["confirmation"]["confirmation_url"]
        payment_request["payment_id"] = yookassa_response["id"]
        payment_request["success"] = True
        
    except Exception as e:
        logger.error(f"💥 [Hook] Ошибка ЮKassa: {e}", exc_info=True)
        payment_request["success"] = False
        payment_request["error"] = str(e)
        
    return payment_request

@router.post("/webhooks/yookassa")
async def yookassa_webhook_handler(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        logger.error("🚫 Неверный JSON в теле вебхука ЮKassa")
        raise HTTPException(400, "Invalid JSON")
        
    event = data.get("event")
    obj = data.get("object", {})
    metadata = obj.get("metadata", {})
    
    # Определяем тип платежа. Фоллбэк на "subscription" для обратной совместимости
    payment_type = metadata.get("type", "subscription")
    
    # <--- ДОБАВЛЕНО: Логирование входящего события
    logger.info(f"📥 Получен вебхук ЮKassa | Event: '{event}' | Type: '{payment_type}' | Metadata: {metadata}")

    # ==========================================
    # ВЕТКА 1: АНОНИМНЫЙ АНАЛИЗ ДОГОВОРА (RAG)
    # ==========================================
    if payment_type == "anonymous_contract_analysis":
        contract_id = metadata.get("contract_id")
        if not contract_id:
            logger.error("🚫 Webhook for anonymous analysis missing contract_id in metadata")
            return {"success": True}
            
        contract = db.query(Contract).filter(Contract.id == contract_id).first()
        if not contract:
            logger.error(f"🚫 Contract {contract_id} not found in DB for webhook processing")
            return {"success": True}
            
        if event == "payment.succeeded":
            logger.info(f"💳 Обработка payment.succeeded для договора ID: {contract_id}")
            try:
                # 1. Обновляем статусы договора и пунктов
                contract.payment_status = "paid"
                contract.status = "processing"  # Фоновая задача сразу сменит на "analyzing"
                
                # <--- ДОБАВЛЕНО: Логирование количества обновляемых пунктов
                updated_count = db.query(ContractClause).filter(
                    ContractClause.contract_id == contract_id,
                    ContractClause.is_selected_for_deep_analysis == True
                ).update({"payment_status": "paid"}, synchronize_session=False)
                
                db.commit()
                logger.info(f"✅ Статусы в БД обновлены: договор #{contract_id}, оплачено пунктов: {updated_count}")
                
                # 2. Собираем ID оплаченных пунктов для передачи в анализ
                paid_clauses = db.query(ContractClause).filter(
                    ContractClause.contract_id == contract_id,
                    ContractClause.payment_status == "paid",
                    ContractClause.is_selected_for_deep_analysis == True # <--- ДОБАВЛЕНО: дополнительная защита
                ).all()
                
                clause_ids = [c.id for c in paid_clauses]
                logger.info(f"📋 Сформирован список ID пунктов для анализа: {clause_ids}")
                
                # 3. Запускаем фоновый анализ
                if clause_ids:
                    logger.info(f"🚀 Вызов asyncio.create_task(background_deep_analysis) для договора {contract_id} и {len(clause_ids)} пунктов")
                    asyncio.create_task(background_deep_analysis(contract_id, clause_ids))
                    logger.info(f"🟢 Фоновая задача успешно добавлена в цикл событий (Event Loop)")
                else:
                    logger.warning(f"⚠️ Оплата прошла, но список пунктов для анализа пуст (contract_id={contract_id})")
                    
            except Exception as e:
                # <--- ДОБАВЛЕНО: Перехват любых ошибок на этапе подготовки БД или запуска задачи
                logger.error(f"💥 КРИТИЧЕСКАЯ ОШИБКА при подготовке payment.succeeded для договора {contract_id}: {e}")
                logger.error(traceback.format_exc())
                db.rollback() # Откатываем транзакцию, чтобы не оставить БД в неконсистентном состоянии
                raise HTTPException(500, "Internal webhook processing error")
                
        elif event == "payment.canceled":
            logger.warning(f"❌ Обработка payment.canceled для договора ID: {contract_id}")
            try:
                contract.payment_status = "failed"
                db.query(ContractClause).filter(
                    ContractClause.contract_id == contract_id,
                    ContractClause.is_selected_for_deep_analysis == True
                ).update({"payment_status": "unpaid"}, synchronize_session=False)
                db.commit()
                logger.info(f"🔄 Статусы договора {contract_id} успешно откатаны из-за отмены оплаты")
            except Exception as e:
                logger.error(f"💥 ОШИБКА при откате статусов для договора {contract_id}: {e}")
                logger.error(traceback.format_exc())
                db.rollback()
                
        # Всегда возвращаем 200 OK, чтобы ЮKassa не спамила повторами
        return {"success": True}

    # ==========================================
    # ВЕТКА 2: ОПЛАТА ПОДПИСКИ (ИЗ billing.py)
    # ==========================================
    payment_id = metadata.get("payment_id")
    if not payment_id:
        logger.warning("⚠️ Webhook received without payment_id in metadata (не anonymous_contract_analysis)")
        return {"success": True} 
        
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        logger.error(f"🚫 Payment {payment_id} not found in DB")
        return {"success": True}
        
    # Обработка событий для подписки
    if event == "payment.succeeded":
        payment.status = "success"
        payment.paid_at = datetime.utcnow()
        # --- МАГИЯ АКТИВАЦИИ ПОДПИСКИ ---
        ws_id = metadata.get("workspace_id")
        tariff_code = metadata.get("tariff_code")
        period = metadata.get("billing_period")
        tariff = db.query(TariffPlan).filter(TariffPlan.code == tariff_code).first()
        if not tariff:
            logger.error(f"🚫 Tariff {tariff_code} not found in DB")
            return {"success": True}
        try:
            billing_period_enum = BillingPeriod(period)
        except ValueError:
            billing_period_enum = BillingPeriod.MONTHLY  # Фоллбэк
            
        # Ищем текущую подписку или создаем новую
        sub = db.query(Subscription).filter(
            Subscription.workspace_id == ws_id,
            Subscription.status.in_([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE])
        ).first()
        now = datetime.utcnow()
        if not sub:
            sub = Subscription(
                workspace_id=ws_id, 
                tariff_plan_id=tariff.id, 
                status=SubscriptionStatus.ACTIVE, 
                billing_period=billing_period_enum, 
                started_at=now
            )
            db.add(sub)
            db.flush()
        else:
            sub.tariff_plan_id = tariff.id
            sub.status = SubscriptionStatus.ACTIVE
            sub.billing_period = billing_period_enum
            
        # Продлеваем срок действия
        base_date = max(sub.expires_at, now) if sub.expires_at else now
        if period == "yearly":
            sub.expires_at = base_date + timedelta(days=365)
        else:
            sub.expires_at = base_date + timedelta(days=30)
        sub.auto_renew = True 
        payment.subscription_id = sub.id
        logger.info(f"✅ Подписка для workspace {ws_id} успешно продлена/активирована")
        
    elif event == "payment.canceled":
        payment.status = "canceled"
        logger.warning(f"⚠️ Оплата подписки {payment_id} отменена")
        
    db.commit()
    return {"success": True}
