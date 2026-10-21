# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import logging
from fastapi import APIRouter
from core.hooks import hooks

from .formula_service import clm_formula_service 

logger = logging.getLogger(__name__)
router = APIRouter()


@hooks.filter("evaluate_formula", weight=10)
def evaluate_formula_hook(payload: dict):
    """
    Перехватывает запрос на вычисление формулы из renderer.py.
    :param payload: Словарь {"formula": str, "context": dict}
    :return: Результат вычисления (str, int, float)
    """
    formula = payload.get("formula", "")
    context = payload.get("context", {})

    logger.debug(f"🧮 [Formula Plugin] Перехвачена формула: {formula}")

    try:
        # Вызываем оригинальный сервис формул
        result = clm_formula_service.evaluate(formula, context)
        
        # Возвращаем результат. Система хуков подхватит это значение 
        # и передаст его дальше (или вернет в renderer.py).
        return result if result is not None else ""
        
    except Exception as e:
        logger.error(f"❌ [Formula Plugin] Ошибка вычисления формулы '{formula}': {e}")
        # В случае ошибки возвращаем саму строку формулы, чтобы не сломать рендер документа
        return formula