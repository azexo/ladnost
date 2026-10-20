# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from config import get_settings
from models import Base

settings = get_settings()

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False # Поставь True для дебага SQL запросов
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency для внедрения сессии БД в роутеры"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_tables():
    """Создание таблиц в БД (вызывается при старте)"""
    Base.metadata.create_all(bind=engine)