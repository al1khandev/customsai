#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пример интеграции TNVEDClassifier с WhatsApp-ботом

Этот файл показывает, как интегрировать классификатор ТН ВЭД
в существующий WhatsApp-бот на Python.

Поддерживаемые библиотеки:
- python-telegram-bot (для Telegram)
- whatsapp-python (для WhatsApp)
- Любая другая библиотека для мессенджеров
"""

import asyncio
import json
from typing import Dict, Optional
from tnved_classifier import TNVEDClassifier, ConfidenceLevel


class TNVEDBotHandler:
    """
    Обработчик запросов ТН ВЭД для мессенджер-бота
    """
    
    def __init__(self):
        self.classifier = TNVEDClassifier()
        self.user_sessions: Dict[str, Dict] = {}  # Хранение сессий пользователей
    
    async def handle_message(self, user_id: str, message: str) -> str:
        """
        Обрабатывает сообщение от пользователя и возвращает ответ
        
        Args:
            user_id: Уникальный идентификатор пользователя
            message: Текст сообщения от пользователя
            
        Returns:
            Ответ для отправки пользователю
        """
        # Проверяем, есть ли активная сессия с уточняющими вопросами
        if user_id in self.user_sessions:
            return await self._handle_clarification(user_id, message)
        
        # Обычная классификация
        result = self.classifier.classify(message)
        
        # Если есть уточняющие вопросы - сохраняем сессию и задаем вопросы
        if result.clarification_questions:
            self.user_sessions[user_id] = {
                'original_description': message,
                'result': result,
                'step': 0
            }
            return self._format_clarification_questions(result.clarification_questions)
        
        # Если уверенность низкая - просим больше информации
        if result.confidence == ConfidenceLevel.LOW:
            return (
                "⚠️ *Требуется больше информации*\n\n"
                "Для точной классификации опишите:\n"
                "1. Основное назначение товара\n"
                "2. Материал изготовления\n"
                "3. Наличие электроники/функций\n"
                "4. Комплектацию и способ использования\n\n"
                "Пример: 'Смарт-часы с ЭКГ, давлением, SpO2, силиконовый ремешок'"
            )
        
        # Возвращаем результат классификации
        return self._format_classification_result(result)
    
    async def _handle_clarification(self, user_id: str, message: str) -> str:
        """
        Обрабатывает ответ на уточняющий вопрос
        """
        session = self.user_sessions[user_id]
        original_desc = session['original_description']
        
        # Объединяем оригинальное описание с ответом пользователя
        enhanced_description = f"{original_desc}. {message}"
        
        # Повторная классификация с расширенным описанием
        result = self.classifier.classify(enhanced_description)
        
        # Удаляем сессию
        del self.user_sessions[user_id]
        
        # Если всё ещё есть вопросы - продолжаем диалог
        if result.clarification_questions:
            self.user_sessions[user_id] = {
                'original_description': enhanced_description,
                'result': result,
                'step': session['step'] + 1
            }
            
            # Ограничиваем количество раундов вопросов
            if session['step'] >= 2:
                return (
                    "🔄 *Промежуточный результат*\n\n"
                    f"{self._format_classification_result(result)}\n\n"
                    "Если результат неверный, пожалуйста, предоставьте больше деталей о товаре."
                )
            
            return self._format_clarification_questions(result.clarification_questions)
        
        # Возвращаем финальный результат
        return (
            "✅ *Классификация обновлена*\n\n"
            f"{self._format_classification_result(result)}"
        )
    
    def _format_clarification_questions(self, questions: list) -> str:
        """Форматирует уточняющие вопросы"""
        questions_text = "\n".join(
            f"{i}. {q}" for i, q in enumerate(questions, 1)
        )
        return (
            "❓ *Для точной классификации уточните:*\n\n"
            f"{questions_text}\n\n"
            "Ответьте на вопросы или предоставьте больше деталей о товаре."
        )
    
    def _format_classification_result(self, result) -> str:
        """Форматирует результат классификации для мессенджера"""
        lines = []
        
        # Основной код
        lines.append(f"📦 *Код ТН ВЭД: {result.main_code}*")
        
        # Альтернативный код
        if result.alternative_code:
            lines.append(f"🔄 *Альтернативный код: {result.alternative_code}*")
        
        # Описание
        if result.description:
            lines.append(f"📝 {result.description}")
        
        # Обоснование
        lines.append(f"\n🔍 *Обоснование:*")
        lines.append(result.rationale)
        
        # Уровень уверенности
        confidence_emoji = {
            ConfidenceLevel.HIGH: "🟢",
            ConfidenceLevel.MEDIUM: "🟡",
            ConfidenceLevel.LOW: "🔴"
        }
        lines.append(f"\n📊 *Уровень уверенности:* {confidence_emoji.get(result.confidence, '')} {result.confidence.value}")
        
        # Предупреждение для низкой уверенности
        if result.confidence == ConfidenceLevel.LOW:
            lines.append("\n⚠️ Рекомендуется дополнительно уточнить код с таможенным брокером.")
        
        # Краткий анализ (первые 3 шага)
        lines.append(f"\n📋 *Анализ:*")
        for step in result.analysis_steps[:3]:
            lines.append(f"  {step}")
        
        return "\n".join(lines)


# ============================================================================
# Пример интеграции с python-telegram-bot (Telegram)
# ============================================================================

try:
    from telegram import Update
    from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
    
    class TelegramTNVEDBot:
        """Пример интеграции с Telegram ботом"""
        
        def __init__(self, token: str):
            self.handler = TNVEDBotHandler()
            self.application = Application.builder().token(token).build()
        
        async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
            """Обработка команды /start"""
            await update.message.reply_text(
                "👋 Добро пожаловать в бот для определения кода ТН ВЭД!\n\n"
                "Просто отправьте описание товара, и я определю код ТН ВЭД ЕАЭС.\n\n"
                "Примеры:\n"
                "• Смарт-часы с ЭКГ\n"
                "• Робот-пылесос\n"
                "• БАД Рейши\n"
                "• Автоковрики EVA"
            )
        
        async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
            """Обработка текстовых сообщений"""
            user_id = str(update.effective_user.id)
            message = update.message.text
            
            # Проверяем, что это не команда
            if message.startswith('/'):
                return
            
            # Обрабатываем запрос
            response = await self.handler.handle_message(user_id, message)
            await update.message.reply_text(response, parse_mode='Markdown')
        
        def run(self):
            """Запуск бота"""
            self.application.add_handler(CommandHandler("start", self.start))
            self.application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self.handle_message))
            self.application.run_polling()
    
except ImportError:
    pass  # python-telegram-bot не установлен


# ============================================================================
# Пример интеграции с whatsapp-python (WhatsApp)
# ============================================================================

try:
    from whatsapp import WhatsApp
    
    class WhatsAppTNVEDBot:
        """Пример интеграции с WhatsApp ботом"""
        
        def __init__(self, token: str):
            self.handler = TNVEDBotHandler()
            self.whatsapp = WhatsApp(token)
        
        async def handle_webhook(self, data: dict):
            """Обработка webhook от WhatsApp"""
            message = data.get('message', {})
            phone_number = message.get('from')
            text = message.get('text', '')
            
            if not text:
                return
            
            # Обрабатываем запрос
            response = await self.handler.handle_message(phone_number, text)
            
            # Отправляем ответ
            await self.whatsapp.send_message(
                phone_number=phone_number,
                text=response
            )
    
except ImportError:
    pass  # whatsapp-python не установлен


# ============================================================================
# Пример простого HTTP API для интеграции с любым ботом
# ============================================================================

from flask import Flask, request, jsonify

app = Flask(__name__)
tnved_handler = TNVEDBotHandler()

@app.route('/api/tnved', methods=['POST'])
def classify_tnved():
    """
    HTTP API endpoint для классификации ТН ВЭД
    
    Пример запроса:
    POST /api/tnved
    {
        "user_id": "user123",
        "description": "Смарт-часы с ЭКГ"
    }
    
    Пример ответа:
    {
        "code": "9102120000",
        "description": "...",
        "rationale": "...",
        "confidence": "высокий",
        "response_text": "📦 Код ТН ВЭД: 9102120000..."
    }
    """
    data = request.get_json()
    
    user_id = data.get('user_id', 'anonymous')
    description = data.get('description', '')
    
    if not description:
        return jsonify({'error': 'Description is required'}), 400
    
    # Синхронная обработка (для Flask)
    result = tnved_handler.classifier.classify(description)
    
    # Формируем ответ
    response = {
        'code': result.main_code,
        'alternative_code': result.alternative_code,
        'description': result.description,
        'rationale': result.rationale,
        'confidence': result.confidence.value,
        'clarification_questions': result.clarification_questions,
        'response_text': tnved_handler._format_classification_result(result)
    }
    
    return jsonify(response)


# ============================================================================
# Пример использования без фреймворков (простой скрипт)
# ============================================================================

def simple_cli_example():
    """Пример использования в CLI (командной строке)"""
    handler = TNVEDBotHandler()
    
    print("🤖 TN VED Classifier - CLI Mode")
    print("Введите описание товара или 'exit' для выхода\n")
    
    while True:
        try:
            user_input = input("📦 Описание товара: ").strip()
            
            if user_input.lower() in ['exit', 'quit', 'выход']:
                print("👋 До свидания!")
                break
            
            if not user_input:
                continue
            
            # Классификация (синхронная для простоты)
            import asyncio
            result = asyncio.run(handler.handle_message("cli_user", user_input))
            
            print(f"\n{result}\n")
            
        except KeyboardInterrupt:
            print("\n👋 До свидания!")
            break
        except Exception as e:
            print(f"❌ Ошибка: {e}")


if __name__ == "__main__":
    # Запуск простого CLI примера
    simple_cli_example()
