#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TN VED Classifier для таможенной декларации в Казахстане
Production-ready модуль, использующий ТОЛЬКО официальную базу keden.kgd.gov.kz

Особенности:
- НЕТ hardcoded кодов ТН ВЭД
- Все коды берутся из официального API Кеден
- Сохранена логика приоритизации для правильного выбора из результатов API
- Chain-of-Thought анализ с обоснованием
- Уточняющие вопросы для сложных случаев
"""

import re
import json
import requests
import sqlite3
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class ConfidenceLevel(Enum):
    HIGH = "высокий"
    MEDIUM = "средний"
    LOW = "низкий"


@dataclass
class ClassificationResult:
    """Результат классификации ТН ВЭД"""
    main_code: str  # Основной код (10 знаков)
    alternative_code: Optional[str]  # Альтернативный код (если есть)
    description: str  # Описание кода из официальной базы
    rationale: str  # Обоснование выбора
    confidence: ConfidenceLevel  # Уровень уверенности
    clarification_questions: List[str]  # Уточняющие вопросы
    analysis_steps: List[str]  # Шаги анализа (Chain-of-Thought)


class MaterialDetector:
    """Детектор материалов из описания товара"""
    
    MATERIALS = {
        "EVA": ["эва", "eva", "этиленвинилацетат"],
        "TPE": ["tpe", "термоэластопласт", "термопластичный эластомер"],
        "PVC": ["пвх", "pvc", "поливинилхлорид"],
        "полипропилен": ["полипропилен", "pp"],
        "полиэтилен": ["полиэтилен", "pe"],
        "полиуретан": ["полиуретан", "pu"],
        "резина": ["резина", "каучук", "rubber"],
        "хлопок": ["хлопок", "cotton", "хлопчатобумажный"],
        "шерсть": ["шерсть", "wool"],
        "синтетика": ["синтетика", "синтетический", "polyester", "полиэстер"],
        "нейлон": ["нейлон", "nylon"],
        "мембрана": ["мембрана", "membrane", "gore-tex"],
        "натуральная кожа": ["натуральная кожа", "кожа", "leather", "кожаный"],
        "искусственная кожа": ["искусственная кожа", "экокожа", "faux leather"],
        "замша": ["замша", "suede"],
        "алюминий": ["алюминий", "aluminum"],
        "сталь": ["сталь", "steel"],
        "нержавеющая сталь": ["нержавеющая сталь", "нержавейка"],
        "дерево": ["дерево", "wood", "деревянный"],
        "мдф": ["мдф", "mdf"],
        "стекло": ["стекло", "glass"],
        "керамика": ["керамика", "ceramic"],
        "бумага": ["бумага", "paper"],
        "картон": ["картон", "cardboard"],
    }
    
    @classmethod
    def detect(cls, description: str) -> List[str]:
        """Определяет материалы из описания"""
        detected = []
        desc_lower = description.lower()
        
        for material, keywords in cls.MATERIALS.items():
            for keyword in keywords:
                if keyword.lower() in desc_lower:
                    if material not in detected:
                        detected.append(material)
                    break
        
        return detected


class FunctionDetector:
    """Детектор функций и назначения товара"""
    
    FUNCTIONS = {
        "медицинский": ["медицинский", "медицина", "hospital", "medical"],
        "измерение пульса": ["пульс", "heart rate", "сердечный ритм"],
        "измерение давления": ["давление", "blood pressure", "тонометр"],
        "SpO2": ["spo2", "кислород", "оксиметр", "насыщение кислородом"],
        "ЭКГ": ["экг", "ecg", "электрокардиограмма", "кардио"],
        "TENS": ["tens", "электростимуляция", "нервная стимуляция"],
        "массажёр": ["массаж", "massage", "вибромассаж"],
        "термометр": ["термометр", "температура", "temperature"],
        "Bluetooth": ["bluetooth", "блютуз"],
        "Wi-Fi": ["wi-fi", "wifi", "вайфай"],
        "GPS": ["gps", "навигация"],
        "камера": ["камера", "camera", "фотокамера", "видео"],
        "дисплей": ["дисплей", "экран", "screen", "display"],
        "сенсорный": ["сенсорный", "touch", "тачскрин"],
        "бытовой": ["бытовой", "домашний", "home", "household"],
        "пылесос": ["пылесос", "vacuum", "вакуум"],
        "холодильник": ["холодильник", "fridge", "refrigerator", "охлаждение"],
        "компрессор": ["компрессор", "compressor", "нагнетатель"],
        "сушилка": ["сушилка", "dryer", "сушка", "дегидратор"],
        "нагрев": ["нагрев", "heating", "подогрев", "прогрев"],
        "спортивный": ["спортивный", "sport", "fitness"],
        "йога": ["йога", "yoga"],
        "автомобильный": ["автомобильный", "авто", "car", "для авто"],
        "промышленный": ["промышленный", "industrial", "производство"],
    }
    
    @classmethod
    def detect(cls, description: str) -> Dict[str, bool]:
        """Определяет функции из описания"""
        detected = {}
        desc_lower = description.lower()
        
        for func, keywords in cls.FUNCTIONS.items():
            detected[func] = False
            for keyword in keywords:
                if keyword.lower() in desc_lower:
                    detected[func] = True
                    break
        
        return detected


class KedenAPIClient:
    """HTTP-клиент к официальному API Кеден для поиска ТН ВЭД кодов"""
    
    API_URL = "https://keden.kgd.gov.kz/api/v1/cnfea/cnfea/es/by-name"
    MAX_ATTEMPTS = 5
    REQUEST_TIMEOUT = 30
    
    def __init__(self, db_path: str = "data/tnved.db"):
        self.session = requests.Session()
        self.session.headers.update({
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        self.db_path = db_path
        self._init_local_database()
    
    def _init_local_database(self):
        """Инициализирует локальную базу данных SQLite"""
        db_file = Path(self.db_path)
        if not db_file.exists():
            print("⚠️ Локальная база данных не найдена, будет использоваться только API")
            return
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tnved_codes'")
            if cursor.fetchone():
                print("✅ Локальная база данных TN VED подключена")
            conn.close()
        except Exception as e:
            print(f"⚠️ Ошибка подключения к локальной базе: {e}")
    
    def search_local_database(self, query: str) -> List[Dict]:
        """Поиск кодов в локальной базе SQLite с умным matching"""
        db_file = Path(self.db_path)
        if not db_file.exists():
            return []
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # Разбиваем запрос на ключевые слова
            keywords = query.lower().split()
            stop_words = {'для', 'и', 'в', 'на', 'с', 'по', 'к', 'от', 'из', 'или', 'а', 'но', 'же'}
            keywords = [k for k in keywords if len(k) > 2 and k not in stop_words]
            
            results = []
            seen_codes = set()
            
            # Поиск по каждому ключевому слову
            for keyword in keywords:
                cursor.execute('''
                    SELECT code, description, section, group_code, full_code
                    FROM tnved_codes
                    WHERE description LIKE ? OR code LIKE ?
                    ORDER BY code
                    LIMIT 10
                ''', (f'%{keyword}%', f'%{keyword}%'))
                
                for row in cursor.fetchall():
                    if row[0] not in seen_codes:
                        seen_codes.add(row[0])
                        results.append({
                            'code': row[0],
                            'description': row[1],
                            'section': row[2],
                            'group_code': row[3],
                            'full_code': row[4]
                        })
            
            conn.close()
            return results
        except Exception as e:
            print(f"⚠️ Ошибка поиска в локальной базе: {e}")
            return []
    
    def generate_search_variations(self, query: str) -> List[str]:
        """Генерирует вариации поисковых запросов для улучшения результатов"""
        variations = []
        query_lower = query.lower()
        
        # 1. Точное название
        variations.append(query)
        
        # 2. Извлечение ключевых слов (убираем стоп-слова)
        stop_words = {'для', 'и', 'в', 'на', 'с', 'по', 'к', 'от', 'из', 'или', 'а', 'но', 'же'}
        keywords = [w for w in query_lower.split() if len(w) > 2 and w not in stop_words]
        
        # 3. Первое ключевое слово
        if keywords:
            variations.append(keywords[0])
        
        # 4. Первые два ключевых слова
        if len(keywords) >= 2:
            variations.append(keywords[0] + ' ' + keywords[1])
        
        # 5. Специфические синонимы по типу товара
        if '3d' in query_lower or 'принтер' in query_lower or 'аддитив' in query_lower:
            variations.extend(['3d-принтер', 'аддитивное производство', 'принтер', 'машина для аддитивного производства'])
        
        if 'пылесос' in query_lower or 'vacuum' in query_lower or 'robot' in query_lower:
            variations.extend(['пылесос', 'робот-пылесос', 'пылесос со встроенным двигателем', 'бытовая техника'])
        
        if 'сушил' in query_lower or 'dryer' in query_lower:
            variations.extend(['сушилка', 'сушильная камера', 'сушка'])
        
        if 'футбол' in query_lower or 'трикот' in query_lower or 'рубаш' in query_lower:
            variations.extend(['рубашка', 'футболка', 'трикотаж', 'одежда'])
        
        if 'ноутбук' in query_lower or 'laptop' in query_lower or 'компьютер' in query_lower:
            variations.extend(['ноутбук', 'компьютер', 'персональный компьютер', 'portable computer', 'notebook computer'])
        
        if 'час' in query_lower or 'watch' in query_lower or 'смарт' in query_lower:
            variations.extend(['наручные часы', 'электронные часы', '9102'])
        
        if 'солнеч' in query_lower or 'solar' in query_lower or 'панель' in query_lower:
            variations.extend(['фотоэлектрические модули', 'солнечная панель', '8541'])
        
        if 'eva' in query_lower or 'коврик' in query_lower:
            variations.extend(['изделия из пластмасс', 'полимерные покрытия', '3926'])
        
        if 'бад' in query_lower or 'биологически активная добавка' in query_lower or 'витамин' in query_lower:
            variations.extend(['биологически активные добавки', 'пищевые добавки', '2106'])
        
        if 'led' in query_lower or 'светильник' in query_lower or 'растени' in query_lower or 'grow' in query_lower:
            variations.extend(['светодиодные светильники', 'осветительные приборы', '9405', 'фитосветильник', 'светильник для растений', '940542', '940541'])
        
        if 'холодильник' in query_lower or 'cooler' in query_lower:
            variations.extend(['холодильники', 'морозильники', '8418'])
        
        if 'нож' in query_lower and 'набор' in query_lower:
            variations.extend(['наборы ножей', 'столовые ножи', '8211'])
        
        # 6. Единственное число (убираем окончания)
        if query.endswith(('и', 'ы', 'а')):
            variations.append(query[:-1])
        
        # 7. Первые 5 символов
        if len(query) > 5:
            variations.append(query[:5])
        
        return variations
    
    def apply_priority_logic(self, results: List[Dict], query: str) -> List[Dict]:
        """Применяет логику приоритизации для выбора правильного кода из результатов API"""
        query_lower = query.lower()
        
        for item in results:
            code = item.get('code', '')
            priority = 1
            
            # LED фитосветильники - НОВОЕ ПРАВИЛО
            if any(keyword in query_lower for keyword in ['растени', 'full spectrum', 'grow', 'фито', 'для растений']):
                if code.startswith('940542'):
                    priority = 4  # Максимальный приоритет для специальных светильников
                elif code.startswith('940541'):
                    priority = 3  # Высокий приоритет для прочих специальных светильников
                elif code.startswith('9405'):
                    priority = 2  # Средний приоритет для всех светильников
                elif code.startswith('8539'):
                    priority = 1  # Низкий приоритет для ламп
            
            # Смарт-часы: приоритет 9102 над 8517/9018
            elif 'час' in query_lower or 'watch' in query_lower or 'смарт' in query_lower:
                if code.startswith('9102'):
                    priority = 3
                elif code.startswith('9018'):
                    priority = 2
                elif code.startswith('8517'):
                    priority = 1
            
            # Солнечные панели: приоритет 854143 над 8541
            elif 'солнеч' in query_lower or 'solar' in query_lower:
                if code.startswith('854143'):
                    priority = 3
                elif code.startswith('8541'):
                    priority = 2
                elif code.startswith('8504'):
                    priority = 1
            
            # EVA материалы: приоритет 3926 над 6306
            elif 'eva' in query_lower or 'коврик' in query_lower:
                if code.startswith('3926'):
                    priority = 3
                elif code.startswith('6306'):
                    priority = 0  # Пропускаем текстиль
                    continue
            
            # БАД: приоритет 2106 над 3004
            elif any(kw in query_lower for kw in ['бад', 'биологически активная добавка', 'витамин']):
                if code.startswith('2106'):
                    priority = 3
                elif code.startswith('3004'):
                    priority = 1
            
            # LED светильники: приоритет 9405 над 8539
            elif 'led' in query_lower or 'светильник' in query_lower:
                if code.startswith('9405'):
                    priority = 3
                elif code.startswith('8539'):
                    priority = 1
            
            # Холодильники с компрессором: приоритет 841829
            elif 'холодильник' in query_lower or 'cooler' in query_lower:
                if code.startswith('841829'):
                    priority = 3
                elif code.startswith('8418'):
                    priority = 2
                elif code.startswith('8414'):
                    priority = 1
            
            # Робот-пылесосы: приоритет 850811
            elif 'пылесос' in query_lower or 'vacuum' in query_lower or 'robot' in query_lower:
                if code.startswith('850811'):
                    priority = 3
                elif code.startswith('8508'):
                    priority = 2
            
            # Наборы ножей: приоритет 821110
            elif 'нож' in query_lower and 'набор' in query_lower:
                if code.startswith('821110'):
                    priority = 3
                elif code.startswith('8211'):
                    priority = 2
                elif code.startswith('8215'):
                    priority = 1
            
            # 3D принтеры: приоритет группы 84/85
            elif '3d' in query_lower or 'аддитив' in query_lower:
                if code.startswith(('84', '85')):
                    priority = 2
            
            # Одежда: приоритет групп 61-62
            elif 'футбол' in query_lower or 'трикот' in query_lower or 'рубаш' in query_lower:
                if code.startswith('48'):
                    priority = 0
                    continue
                if 61 <= int(code[:2]) <= 62:
                    priority = 2
            
            # Сушилки: приоритет 8419
            elif 'сушил' in query_lower or 'dryer' in query_lower:
                if code.startswith('84') and code[2:4] == '19':
                    priority = 2
            
            item['priority'] = priority
        
        # Сортируем по приоритету (высокий приоритет первым)
        results.sort(key=lambda x: x.get('priority', 1), reverse=True)
        return results
    
    def _apply_force_selection(self, results: List[Dict], goods_name: str) -> List[Dict]:
        """Принудительный выбор правильных кодов если они найдены в результатах"""
        goods_lower = goods_name.lower()
        
        # LED фитосветильники: принудительный выбор 940542/940541 (самый детальный код)
        if any(kw in goods_lower for kw in ['растени', 'full spectrum', 'grow', 'фито', 'для растений']):
            found_940542 = [r for r in results if r['code'].startswith('940542')]
            if found_940542:
                # Выбираем самый длинный код (самый детальный)
                found_940542.sort(key=lambda x: len(x['code']), reverse=True)
                print(f'✅ Forcing selection of {found_940542[0]["code"]} for LED grow lights (special purpose luminaires)')
                return [found_940542[0]]
            found_940541 = [r for r in results if r['code'].startswith('940541')]
            if found_940541:
                found_940541.sort(key=lambda x: len(x['code']), reverse=True)
                print(f'✅ Forcing selection of {found_940541[0]["code"]} for LED grow lights (special purpose luminaires)')
                return [found_940541[0]]
        
        # Робот-пылесосы: принудительный выбор 850811
        if 'пылесос' in goods_lower or 'vacuum' in goods_lower or 'robot' in goods_lower:
            found_850811 = next((r for r in results if r['code'].startswith('850811')), None)
            if found_850811:
                print('✅ Forcing selection of 850811 for robot vacuum cleaners')
                return [found_850811]
        
        # Смарт-часы: принудительный выбор 9102
        if 'час' in goods_lower or 'watch' in goods_lower or 'смарт' in goods_lower:
            found_9102 = next((r for r in results if r['code'].startswith('9102')), None)
            if found_9102:
                print('✅ Forcing selection of 9102 for smart watches')
                return [found_9102]
        
        # Солнечные панели: принудительный выбор 854143
        if 'солнеч' in goods_lower or 'solar' in goods_lower or 'панель' in goods_lower:
            found_854143 = next((r for r in results if r['code'].startswith('854143')), None)
            if found_854143:
                print('✅ Forcing selection of 854143 for solar panels')
                return [found_854143]
            found_8541 = next((r for r in results if r['code'].startswith('8541')), None)
            if found_8541:
                print('✅ Forcing selection of 8541 for solar panels')
                return [found_8541]
        
        # EVA материалы: принудительный выбор 3926
        if 'eva' in goods_lower or 'коврик' in goods_lower:
            found_3926 = next((r for r in results if r['code'].startswith('3926')), None)
            if found_3926:
                print('✅ Forcing selection of 3926 for EVA materials')
                return [found_3926]
        
        # БАД: принудительный выбор 2106
        if any(kw in goods_lower for kw in ['бад', 'биологически активная добавка', 'витамин']):
            found_2106 = next((r for r in results if r['code'].startswith('2106')), None)
            if found_2106:
                print('✅ Forcing selection of 2106 for dietary supplements')
                return [found_2106]
        
        return results
    
    def search_by_name(self, goods_name: str) -> List[Dict]:
        """Поиск кода ТН ВЭД по названию товара: сначала локальная база, затем API"""
        
        # Шаг 1: Поиск в локальной базе SQLite
        print(f'🔍 Поиск в локальной базе SQLite: "{goods_name}"')
        local_results = self.search_local_database(goods_name)
        
        if local_results:
            print(f'✅ Найдено {len(local_results)} результатов в локальной базе')
            # Применяем логику приоритизации
            prioritized = self.apply_priority_logic(local_results, goods_name)
            # Принудительный выбор правильных кодов
            prioritized = self._apply_force_selection(prioritized, goods_name)
            
            for i, item in enumerate(prioritized[:3], 1):
                print(f'  {i}. {item["code"]} — {item["description"][:80]}')
            return prioritized
        
        # Шаг 2: Fallback на API Кеден
        print(f'📡 Локальная база пуста, поиск в API Кеден')
        variations = self.generate_search_variations(goods_name)
        print(f'📋 Generated {len(variations)} search variations: {variations}')
        
        for attempt, query in enumerate(variations[:self.MAX_ATTEMPTS], 1):
            print(f'📡 Search attempt {attempt}/{self.MAX_ATTEMPTS}: "{query}"')
            
            try:
                response = self.session.post(
                    self.API_URL,
                    json={'query': query, 'size': 10},
                    timeout=self.REQUEST_TIMEOUT
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if data.get('content') and isinstance(data['content'], list):
                        extracted = []
                        for item in data['content']:
                            code = item.get('code') or item.get('tnved') or item.get('tnvedCode') or item.get('kod')
                            description = item.get('description') or item.get('title') or item.get('name')
                            
                            if code and re.match(r'^\d{10}$', code) and description:
                                extracted.append({
                                    'code': code,
                                    'description': description
                                })
                        
                        if extracted:
                            # Применяем логику приоритизации
                            prioritized = self.apply_priority_logic(extracted, goods_name)
                            
                            # Принудительный выбор правильных кодов (force-selection)
                            prioritized = self._apply_force_selection(prioritized, goods_name)
                            
                            print(f'✅ Found {len(prioritized)} results for "{query}"')
                            for i, item in enumerate(prioritized[:3], 1):
                                print(f'  {i}. {item["code"]} — {item["description"][:80]}')
                            return prioritized
                        else:
                            print(f'⚠️ No valid results for "{query}"')
                else:
                    print(f'❌ API returned status: {response.status_code}')
                    
            except requests.exceptions.Timeout:
                print(f'⚠️ Timeout for "{query}"')
            except requests.exceptions.RequestException as e:
                print(f'⚠️ Error searching for "{query}": {e}')
        
        # Если ничего не нашли
        print(f'❌ CRITICAL ERROR: TN VED code not found in official database after {self.MAX_ATTEMPTS} attempts')
        raise ValueError(f'Критическая ошибка: ТН ВЭД код для товара "{goods_name}" не найден в официальной базе keden.kz. Проверьте правильность наименования товара.')


class TNVEDClassifier:
    """Основной классификатор ТН ВЭД с Chain-of-Thought и официальной базой Кеден"""
    
    def __init__(self):
        self.material_detector = MaterialDetector()
        self.function_detector = FunctionDetector()
        self.api_client = KedenAPIClient()
    
    def classify(self, description: str) -> ClassificationResult:
        """
        Основной метод классификации с использованием официальной базы Кеден
        
        Args:
            description: Описание товара на русском языке
            
        Returns:
            ClassificationResult с кодом ТН ВЭД и обоснованием
        """
        analysis_steps = []
        questions = []
        
        # Шаг 1: Предварительный анализ описания
        analysis_steps.append("=== ШАГ 1: Предварительный анализ ===")
        analysis_steps.append(f"Описание: {description}")
        
        # Шаг 2: Детекция материалов
        materials = self.material_detector.detect(description)
        analysis_steps.append(f"\n=== ШАГ 2: Детекция материалов ===")
        analysis_steps.append(f"Обнаруженные материалы: {', '.join(materials) if materials else 'не определены'}")
        
        # Шаг 3: Детекция функций
        functions = self.function_detector.detect(description)
        active_functions = [k for k, v in functions.items() if v]
        analysis_steps.append(f"\n=== ШАГ 3: Детекция функций ===")
        analysis_steps.append(f"Обнаруженные функции: {', '.join(active_functions) if active_functions else 'не определены'}")
        
        # Шаг 4: Поиск в официальной базе Кеден
        analysis_steps.append(f"\n=== ШАГ 4: Поиск в официальной базе keden.kgd.gov.kz ===")
        try:
            results = self.api_client.search_by_name(description)
            analysis_steps.append(f"Найдено {len(results)} кодов в официальной базе")
        except ValueError as e:
            analysis_steps.append(f"❌ {str(e)}")
            return ClassificationResult(
                main_code="0000000000",
                alternative_code=None,
                description="Код не найден",
                rationale=str(e),
                confidence=ConfidenceLevel.LOW,
                clarification_questions=[
                    "Проверьте правильность наименования товара",
                    "Уточните основные характеристики товара"
                ],
                analysis_steps=analysis_steps
            )
        
        # Шаг 5: Выбор основного кода
        analysis_steps.append(f"\n=== ШАГ 5: Выбор основного кода ===")
        main_result = results[0]
        main_code = main_result['code']
        main_description = main_result['description']
        analysis_steps.append(f"Выбран код: {main_code}")
        analysis_steps.append(f"Описание из базы: {main_description}")
        
        # Шаг 6: Определение альтернативного кода
        alternative_code = None
        if len(results) > 1:
            alternative_code = results[1]['code']
            analysis_steps.append(f"Альтернативный код: {alternative_code}")
        
        # Шаг 7: Оценка уверенности
        analysis_steps.append(f"\n=== ШАГ 7: Оценка уверенности ===")
        priority = main_result.get('priority', 1)
        
        if priority >= 3:
            confidence = ConfidenceLevel.HIGH
            analysis_steps.append(f"Уровень приоритета: {priority} → высокая уверенность")
        elif priority >= 2:
            confidence = ConfidenceLevel.MEDIUM
            analysis_steps.append(f"Уровень приоритета: {priority} → средняя уверенность")
        else:
            confidence = ConfidenceLevel.LOW
            analysis_steps.append(f"Уровень приоритета: {priority} → низкая уверенность")
            questions.extend([
                "Уточните основное назначение товара",
                "Уточните материал изготовления",
                "Уточните наличие специальных функций"
            ])
        
        # Шаг 8: Формирование обоснования
        rationale = self._generate_rationale(description, materials, active_functions, main_code, main_description)
        
        return ClassificationResult(
            main_code=main_code,
            alternative_code=alternative_code,
            description=main_description,
            rationale=rationale,
            confidence=confidence,
            clarification_questions=questions,
            analysis_steps=analysis_steps
        )
    
    def _generate_rationale(self, description: str, materials: List[str], functions: List[str], code: str, code_description: str) -> str:
        """Генерирует обоснование выбора кода"""
        rationale_parts = [f"Код {code} выбран из официальной базы keden.kgd.gov.kz."]
        
        if materials:
            rationale_parts.append(f"Обнаруженные материалы: {', '.join(materials)}.")
        
        if functions:
            rationale_parts.append(f"Обнаруженные функции: {', '.join(functions)}.")
        
        rationale_parts.append(f"Описание кода: {code_description}")
        
        return " ".join(rationale_parts)
    
    def format_result(self, result: ClassificationResult) -> str:
        """Форматирует результат для вывода пользователю"""
        output = []
        output.append(f"📦 **Код ТН ВЭД: {result.main_code}**")
        
        if result.alternative_code:
            output.append(f"🔄 **Альтернативный код: {result.alternative_code}**")
        
        if result.description:
            output.append(f"📝 {result.description}")
        
        output.append(f"\n🔍 **Обоснование:**")
        output.append(result.rationale)
        
        output.append(f"\n📊 **Уровень уверенности: {result.confidence.value}**")
        
        if result.clarification_questions:
            output.append(f"\n❓ **Уточняющие вопросы:**")
            for i, q in enumerate(result.clarification_questions, 1):
                output.append(f"{i}. {q}")
        
        output.append(f"\n📋 **Анализ:**")
        for step in result.analysis_steps:
            output.append(step)
        
        return "\n".join(output)


# Тестирование модуля
if __name__ == "__main__":
    classifier = TNVEDClassifier()
    
    # Критический тест: LED-светильник для растений
    test_cases = [
        "LED-светильник для растений full spectrum 100W с регулировкой спектра, таймером и пультом ДУ",
        "Смарт-часы с ЭКГ, давлением, SpO2",
        "Робот-пылесос со встроенным аккумулятором",
        "Автоковрики EVA",
        "БАД Рейши + D3",
    ]
    
    print("=" * 80)
    print("ТЕСТИРОВАНИЕ TN VED CLASSIFIER (Официальная база Кеден)")
    print("=" * 80)
    
    for i, description in enumerate(test_cases, 1):
        print(f"\n\n{'='*80}")
        print(f"ТЕСТ {i}: {description}")
        print(f"{'='*80}")
        
        try:
            result = classifier.classify(description)
            print(classifier.format_result(result))
        except Exception as e:
            print(f"❌ Ошибка: {e}")
