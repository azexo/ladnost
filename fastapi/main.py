# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import create_tables
import uvicorn
import logging
from fastapi.staticfiles import StaticFiles
import os
from core.plugin_loader import load_plugins
from core.hooks import hooks

from dotenv import load_dotenv
load_dotenv() 


from routers import (
    auth, users, folders, document_sets, documents, 
    questionnaire, formulations, tasks, comments, 
    notifications, trash, template_import,
    workspaces, billing, webhooks,
    renderer,
    api_keys,
    integrations,
)

logging.basicConfig(
    level=logging.INFO, # Уровень логирования (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("app.log", encoding='utf-8'), # Запись в файл
        logging.StreamHandler() # Дублирование в консоль (опционально)
    ]
)

app = FastAPI(
    title="Contract Management System API",
    description="Backend API",
    version="1.0.0"
)

load_plugins(app)

os.makedirs("uploads/tickets", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# CORS (обязательно для фронтенда)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # В продакшене укажи конкретный домен фронта
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутеров с префиксами (как в realApi.ts)
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(folders.router, prefix="/api/v1/folders", tags=["Folders"])
app.include_router(document_sets.router, prefix="/api/v1/document-sets", tags=["Document Sets"])
app.include_router(renderer.router, prefix="/api/v1/documents", tags=["Documents"])
app.include_router(documents.router, prefix="/api/v1/documents", tags=["Documents"])
app.include_router(questionnaire.router, prefix="/api/v1/questionnaire", tags=["Questionnaire"])
app.include_router(formulations.router, prefix="/api/v1/formulations", tags=["Formulations"])
app.include_router(tasks.router, prefix="/api/v1/tasks", tags=["Tasks"])
app.include_router(comments.router, prefix="/api/v1/comments", tags=["Comments"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(trash.router, prefix="/api/v1/trash", tags=["Trash"])
app.include_router(template_import.router, prefix="/api/v1/template_import", tags=["Template import"])


app.include_router(api_keys.router, prefix="/api/v1/workspaces", tags=["API Keys"])
app.include_router(workspaces.router, prefix="/api/v1/workspaces", tags=["Workspaces"])
app.include_router(billing.router, prefix="/api/v1/billing", tags=["Billing"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["Webhooks"])

app.include_router(integrations.router, prefix="/api/v1/integrations", tags=["Integrations"])



@app.on_event("startup")
async def startup_event():
    await hooks.action("app.started", {"message": "Core is up!"})
    # Создание таблиц при первом запуске
    create_tables()

@app.get("/")
async def root():
    return {"message": "API is running."}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)