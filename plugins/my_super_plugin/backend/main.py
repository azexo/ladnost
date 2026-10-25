# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: LicenseRef-Commercial

from fastapi import APIRouter
# Импортируем ядро (так как мы добавили plugins в sys.path, а core лежит в fastapi)
# В реальном проекте лучше настроить PYTHONPATH или установить core как пакет
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../fastapi')))
from core.hooks import hooks
import logging
logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/status")
async def get_status():
    return {"plugin": "super", "status": "active"}

# Подписываемся на событие ядра
@hooks.on("app.started")
async def on_app_started(payload):
    logger.info(f"[Super Plugin] App started! Payload: {payload}")