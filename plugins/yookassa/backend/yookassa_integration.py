# SPDX-FileCopyrightText: 2026 Andrey Soloduhin
#
# SPDX-License-Identifier: Apache-2.0

import aiohttp
import os
from typing import Dict, Any
import json
import base64
import hashlib
import hmac
from datetime import datetime
import uuid

class YooKassaAPI:
    def __init__(self):
        self.shop_id = os.getenv("YOOKASSA_SHOP_ID")
        self.secret_key = os.getenv("YOOKASSA_SECRET_KEY")
        # Исправлена опечатка в URL: убрана лишняя пробел в конце
        self.base_url = "https://api.yookassa.ru/v3"

    # --- Существующие методы ---
    async def create_payment(self, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        """Создание платежа в YooKassa"""
        url = f"{self.base_url}/payments"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}",
            "Idempotence-Key": self._generate_idempotence_key()
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payment_data, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa API error: {response.status} - {error_text}")

    async def get_payment(self, payment_id: str) -> Dict[str, Any]:
        """Получение информации о платеже"""
        url = f"{self.base_url}/payments/{payment_id}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}"
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa API error: {response.status} - {error_text}")

    async def create_payout(self, payout_data: Dict[str, Any]) -> Dict[str, Any]:
        """Создание выплаты в YooKassa"""
        url = f"{self.base_url}/payouts"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}",
            "Idempotence-Key": self._generate_idempotence_key()
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payout_data, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa API error: {response.status} - {error_text}")

    async def get_payout(self, payout_id: str) -> Dict[str, Any]:
        """Получение информации о выплате"""
        url = f"{self.base_url}/payouts/{payout_id}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}"
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa API error: {response.status} - {error_text}")

    async def cancel_payment(self, payment_id: str) -> Dict[str, Any]:
        """Отмена платежа"""
        url = f"{self.base_url}/payments/{payment_id}/cancel"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}",
            "Idempotence-Key": self._generate_idempotence_key()
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa API error: {response.status} - {error_text}")

    async def create_refund(self, refund_data: Dict[str, Any]) -> Dict[str, Any]:
        """Создание возврата в YooKassa"""
        url = f"{self.base_url}/refunds"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Basic {self._get_auth_header()}",
            "Idempotence-Key": self._generate_idempotence_key()
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=refund_data, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise Exception(f"YooKassa Refund API error: {response.status} - {error_text}")

    def _get_auth_header(self) -> str:
        """Генерация заголовка авторизации"""
        auth_string = f"{self.shop_id}:{self.secret_key}"
        return base64.b64encode(auth_string.encode()).decode()

    def _generate_idempotence_key(self) -> str:
        """Генерация ключа идемпотентности"""
        return str(uuid.uuid4())

# Глобальный экземпляр
yookassa_api = YooKassaAPI()

# --- Функции-обертки для экспорта ---
async def create_payment(payment_data: Dict[str, Any]) -> Dict[str, Any]:
    """Создание платежа"""
    return await yookassa_api.create_payment(payment_data)

async def get_payment(payment_id: str) -> Dict[str, Any]:
    """Получение информации о платеже"""
    return await yookassa_api.get_payment(payment_id)

async def create_payout(payout_data: Dict[str, Any]) -> Dict[str, Any]:
    """Создание выплаты"""
    return await yookassa_api.create_payout(payout_data)

async def get_payout(payout_id: str) -> Dict[str, Any]:
    """Получение информации о выплате"""
    return await yookassa_api.get_payout(payout_id)

async def cancel_payment(payment_id: str) -> Dict[str, Any]:
    """Отмена платежа"""
    return await yookassa_api.cancel_payment(payment_id)

# --- НОВАЯ ФУНКЦИЯ-ОБЕРТКА: create_refund ---
async def create_refund(refund_data: Dict[str, Any]) -> Dict[str, Any]:
    """Создание возврата"""
    return await yookassa_api.create_refund(refund_data)

# --- Существующие вспомогательные функции ---
def verify_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    """Проверка подписи webhook от YooKassa"""
    hash_object = hmac.new(secret.encode(), body, hashlib.sha256)
    expected_signature = hash_object.hexdigest()
    return hmac.compare_digest(expected_signature, signature)

# --- ИСПРАВЛЕНАЯ ФУНКЦИЯ: create_payment_data ---
# Добавлен параметр metadata
def create_payment_data(amount: float, currency: str = "RUB", description: str = "",
                       return_url: str = "", customer_data: Dict[str, Any] = None,
                       metadata: Dict[str, Any] = None) -> Dict[str, Any]: # <-- Добавлен metadata
    """Создание данных для платежа"""
    payment_data = {
        "amount": {
            "value": str(amount),
            "currency": currency
        },
        "description": description,
        "confirmation": {
            "type": "redirect",
            "return_url": return_url
        },
        "capture": True
    }

    if customer_data:
        payment_data["customer"] = customer_data

    # Добавляем metadata, если она предоставлена
    if metadata:
        payment_data["metadata"] = metadata # <-- Добавление metadata в словарь

    return payment_data

def create_payout_data(amount: float, currency: str = "RUB",
                      payout_destination_data: Dict[str, Any] = None,
                      description: str = "") -> Dict[str, Any]:
    """Создание данных для выплаты"""
    payout_data = {
        "amount": {
            "value": str(amount),
            "currency": currency
        },
        "description": description
    }

    if payout_destination_data:
        payout_data["payout_destination_data"] = payout_destination_data

    return payout_data

def create_bank_card_payout(card_data: Dict[str, Any]) -> Dict[str, Any]:
    """Создание данных для выплаты на банковскую карту"""
    return {
        "type": "bank_card",
        "card": card_data
    }

def create_yoo_money_payout(account_number: str) -> Dict[str, Any]:
    """Создание данных для выплаты на кошелек ЮMoney"""
    return {
        "type": "yoo_money",
        "account_number": account_number
    }

def create_sbp_payout(phone: str) -> Dict[str, Any]:
    """Создание данных для выплаты через СБП"""
    return {
        "type": "sbp",
        "phone": phone
    }

# --- НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: create_refund_data ---
def create_refund_data(payment_id: str, amount: float, currency: str = "RUB", description: str = "") -> Dict[str, Any]:
    """Создание данных для возврата"""
    refund_data = {
        "payment_id": payment_id, # ID платежа, по которому делается возврат
        "amount": {
            "value": str(amount), # Сумма возврата, строка
            "currency": currency
        },
        "description": description # Описание возврата (опционально)
    }
    # Можно добавить другие поля, например, "receipt" для чека возврата
    # if receipt_data:
    #     refund_data["receipt"] = receipt_data
    return refund_data
