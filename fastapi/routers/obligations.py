# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel

# Импорты из вашего проекта
from database import get_db # Убедитесь, что get_db экспортируется из database.py
from models import ContractObligation, DocumentSet, DocumentVersion, ObligationParty, ObligationRisk
# Импорты для проверки прав доступа (замените на ваши актуальные зависимости)
from utils import get_current_user 
from models import User

router = APIRouter()

# ==========================================
# PYDANTIC SCHEMAS
# ==========================================
class ObligationResponse(BaseModel):
    id: int
    document_set_id: int
    document_version_id: int
    text_content: str
    clause_reference: Optional[str] = None
    party: ObligationParty
    deadline_text: Optional[str] = None
    deadline_date: Optional[date] = None
    risk_level: ObligationRisk
    is_active: bool
    extracted_at: datetime
    ai_confidence: Optional[Decimal] = None

    class Config:
        from_attributes = True

class ObligationUpdate(BaseModel):
    is_active: Optional[bool] = None
    risk_level: Optional[ObligationRisk] = None
    # Можно добавить другие поля, если фронтенд будет их отправлять

class ExtractResponse(BaseModel):
    status: str
    message: str
    extracted_count: int = 0

# ==========================================
# ENDPOINTS
# ==========================================

@router.get(
    "/document-sets/{set_id}/obligations", 
    response_model=List[ObligationResponse],
    summary="Получить список обязательств для комплекта документов"
)
async def get_obligations_by_set(
    set_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Проверяем существование комплекта
    document_set = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    if not document_set:
        raise HTTPException(status_code=404, detail="Комплект документов не найден")
    
    # 2. Получаем обязательства
    obligations = db.query(ContractObligation).filter(
        ContractObligation.document_set_id == set_id
    ).order_by(ContractObligation.extracted_at.desc()).all()
    
    return obligations


@router.post(
    "/document-sets/{set_id}/obligations/extract",
    response_model=ExtractResponse,
    summary="Запустить AI-извлечение обязательств из документов"
)
async def extract_obligations(
    set_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # 1. Проверяем существование комплекта
    document_set = db.query(DocumentSet).filter(DocumentSet.id == set_id).first()
    if not document_set:
        raise HTTPException(status_code=404, detail="Комплект документов не найден")

    # 2. Получаем текущие версии документов для анализа
    # В реальном проекте здесь будет вызов вашего AI-сервиса (LLM)
    # Ниже приведена заглушка, которая генерирует тестовые данные
    
    # Получаем последний документ из комплекта для примера
    latest_version = db.query(DocumentVersion).join(DocumentVersion.document).filter(
        DocumentVersion.document.has(document_set_id=set_id),
        DocumentVersion.is_current == True
    ).first()

    if not latest_version:
        raise HTTPException(status_code=400, detail="В комплекте нет документов для анализа")

    # --- НАЧАЛО ЗАГЛУШКИ AI-АНАЛИЗА ---
    # Здесь должен быть вызов вашего AI-агента:
    # ai_result = await ai_service.extract_obligations(latest_version.content_html)
    
    # Для демонстрации создадим 2 тестовых обязательства
    mock_obligations = [
        {
            "text_content": "Неустойка 0,5% в день за просрочку поставки",
            "clause_reference": "п. 6.2",
            "party": ObligationParty.SUPPLIER,
            "deadline_text": "При просрочке",
            "risk_level": ObligationRisk.HIGH,
            "ai_confidence": 0.95
        },
        {
            "text_content": "Предоплата 70% в течение 3 дней",
            "clause_reference": "п. 4.1",
            "party": ObligationParty.BUYER,
            "deadline_text": "3 раб. дня",
            "risk_level": ObligationRisk.HIGH,
            "ai_confidence": 0.88
        }
    ]
    # --- КОНЕЦ ЗАГЛУШКИ ---

    # 3. Сохраняем результаты в БД (предварительно можно удалить старые, если это перезапуск)
    db.query(ContractObligation).filter(ContractObligation.document_set_id == set_id).delete()
    
    created_count = 0
    for item in mock_obligations:
        new_obligation = ContractObligation(
            document_set_id=set_id,
            document_version_id=latest_version.id,
            text_content=item["text_content"],
            clause_reference=item["clause_reference"],
            party=item["party"],
            deadline_text=item["deadline_text"],
            risk_level=item["risk_level"],
            ai_confidence=item["ai_confidence"],
            is_active=True
        )
        db.add(new_obligation)
        created_count += 1

    db.commit()

    return {
        "status": "success",
        "message": f"AI-анализ завершен. Извлечено обязательств: {created_count}",
        "extracted_count": created_count
    }


@router.patch(
    "/obligations/{obligation_id}",
    response_model=ObligationResponse,
    summary="Обновить данные обязательства (статус, риск)"
)
async def update_obligation(
    obligation_id: int,
    data: ObligationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    obligation = db.query(ContractObligation).filter(ContractObligation.id == obligation_id).first()
    if not obligation:
        raise HTTPException(status_code=404, detail="Обязательство не найдено")

    # Обновляем только переданные поля
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(obligation, key, value)

    db.commit()
    db.refresh(obligation)
    
    return obligation