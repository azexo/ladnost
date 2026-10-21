// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// test-formula.ts
import { clmFormulaService } from './formula-service';
import assert from 'node:assert';

console.log('🚀 Запуск расширенных тестов CLMFormulaService...\n');

let passed = 0;
let failed = 0;

function runTest(name: string, testFn: () => void) {
    try {
        testFn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error: any) {
        console.error(`❌ ${name}`);
        
        // Улучшенный вывод для отладки
        if (error.name === 'AssertionError') {
            console.error(`   ➡️ Ожидалось: ${JSON.stringify(error.expected)}`);
            console.error(`   ➡️ Получено:  ${JSON.stringify(error.actual)}`);
            console.error(`   ➡️ Оператор:  ${error.operator}`);
        } else {
            console.error(`   ➡️ Исключение: ${error.message}`);
            if (error.stack) {
                // Выводим только первые 2 строки стека для краткости
                console.error(`   ➡️ Стек: ${error.stack.split('\n').slice(1, 3).join('\n')}`);
            }
        }
        console.error(''); // Пустая строка для разделения ошибок
        failed++;
    }
}

// ==========================================
// 1. Базовые функции, математика и логика
// ==========================================
runTest('СУММ, ОКРУГЛ и базовая математика', () => {
    assert.strictEqual(clmFormulaService.evaluate('=СУММ(1; 2; 3; 4)'), 10);
    assert.strictEqual(clmFormulaService.evaluate('=ОКРУГЛ(3.1415; 2)'), 3.14);
    assert.strictEqual(clmFormulaService.evaluate('=ОКРУГЛВВЕРХ(3.141; 2)'), 3.15);
    assert.strictEqual(clmFormulaService.evaluate('=ОКРУГЛВНИЗ(3.149; 2)'), 3.14);
    assert.strictEqual(clmFormulaService.evaluate('=ЦЕЛОЕ(3.99)'), 3);
});

runTest('Вложенные математические операции', () => {
    assert.strictEqual(clmFormulaService.evaluate('=СУММ(10; 20) * 2'), 60);
    assert.strictEqual(clmFormulaService.evaluate('=(10 + 5) / 3'), 5);
});

runTest('Логические функции (ЕСЛИ, И, ИЛИ, НЕ)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ЕСЛИ(1 > 0; "Да"; "Нет")'), 'Да');
    assert.strictEqual(clmFormulaService.evaluate('=И(1 > 0; 2 > 1)'), true);
    assert.strictEqual(clmFormulaService.evaluate('=ИЛИ(1 > 2; 2 > 1)'), true);
    assert.strictEqual(clmFormulaService.evaluate('=НЕ(1 > 2)'), true);
    assert.strictEqual(clmFormulaService.evaluate('=ЕСЛИ(И(1 > 0; 2 > 1); "Успех"; "Провал")'), 'Успех');
});

runTest('Обработка ошибок в логике (ЕСЛИОШИБКА)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ЕСЛИОШИБКА(1/0; "Деление на ноль")'), 'Деление на ноль');
});

// ==========================================
// 2. Текстовые функции и очистка данных
// ==========================================
runTest('ДЛСТР, ЛЕВСИМВ, ПРАВСИМВ, ПСТР', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ДЛСТР("Привет")'), 6);
    assert.strictEqual(clmFormulaService.evaluate('=ЛЕВСИМВ("Привет"; 3)'), 'При');
    assert.strictEqual(clmFormulaService.evaluate('=ПРАВСИМВ("Привет"; 3)'), 'вет');
    assert.strictEqual(clmFormulaService.evaluate('=ПСТР("Привет мир"; 8; 3)'), 'мир');
});

runTest('СЖПРОБЕЛЫ, ПОДСТАВИТЬ, СЦЕПИТЬ', () => {
    assert.strictEqual(clmFormulaService.evaluate('=СЖПРОБЕЛЫ("  Привет   мир   ")'), 'Привет мир');
    assert.strictEqual(clmFormulaService.evaluate('=ПОДСТАВИТЬ("Кот ест"; "Кот"; "Пес")'), 'Пес ест');
    assert.strictEqual(clmFormulaService.evaluate('=СЦЕПИТЬ("Привет"; " "; "Мир")'), 'Привет Мир');
});

runTest('ПРОПИСН (Корректная капитализация)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ПРОПИСН("иванов иван иванович")'), 'Иванов Иван Иванович');
    assert.strictEqual(clmFormulaService.evaluate('=ПРОПИСН("г. омск")'), 'Г. Омск');
});

runTest('ПЕЧСИМВ (Очистка от невидимых символов)', () => {
    // Символ \x00 - это null byte, невидимый управляющий символ
    assert.strictEqual(clmFormulaService.evaluate('=ПЕЧСИМВ("Текст\x00с\x1Fсимволами")'), 'Текстссимволами');
});

// ==========================================
// 3. Работа с ФИО (Склонение)
// ==========================================
runTest('СКЛОНЯТЬ_ФИО (Родительный и Дательный падежи)', () => {
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_ФИО("Иванов"; "Иван"; "Иванович"; "родительный")'),
        'Иванова Ивана Ивановича'
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_ФИО("Иванов"; "Иван"; "Иванович"; "дательный")'),
        'Иванову Ивану Ивановичу'
    );
});

runTest('СКЛОНЯТЬ_ФИО (Без отчества: Женское и Мужское)', () => {
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_ФИО("Сидорова"; "Анна"; ""; "родительный")'),
        'Сидоровой Анны'
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_ФИО("Петров"; "Сергей"; ""; "винительный")'),
        'Петрова Сергея'
    );
});


// ==========================================
// 3.1. Работа с названиями и терминами (Склонение)
// ==========================================
runTest('СКЛОНЯТЬ_НАЗВАНИЕ (Головные существительные)', () => {
    // Склоняется первое слово "Договор"
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Договор поставки"; "родительный")'),
        'Договора поставки'
    );
    // Склоняется первое слово "Общество"
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Общество с ограниченной ответственностью"; "дательный")'),
        'Обществу с ограниченной ответственностью'
    );
});

runTest('СКЛОНЯТЬ_НАЗВАНИЕ (Второстепенные существительные)', () => {
    // Первое слово не в словаре, склоняется последнее "товар"
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Оплата за товар"; "творительный")'),
        'Оплатой за товар'
    );
    // Первое слово не в словаре, склоняется последнее "аренда"
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Право на аренду"; "винительный")'),
        'Право на аренду'
    );
});

runTest('СКЛОНЯТЬ_НАЗВАНИЕ (Одиночные слова и регистр)', () => {
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Акт"; "родительный")'),
        'Акта'
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Спецификация"; "дательный")'),
        'Спецификации'
    );
    // Проверка сохранения нижнего регистра
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("договор"; "родительный")'),
        'договора'
    );
});

runTest('СКЛОНЯТЬ_НАЗВАНИЕ (Обработка ошибок и неизвестных слов)', () => {
    // Если слова нет в словаре, возвращается исходная строка
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Неизвестный термин"; "родительный")'),
        'Неизвестного термина'
    );
    // Некорректный падеж
    assert.strictEqual(
        clmFormulaService.evaluate('=СКЛОНЯТЬ_НАЗВАНИЕ("Договор"; "несуществующий_падеж")'),
        '#VALUE!'
    );
});

// ==========================================
// 4. Даты и сроки (CLM Core)
// ==========================================
runTest('ДОБАВИТЬ_ДНИ и ДОБАВИТЬ_МЕСЯЦЫ', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ДОБАВИТЬ_ДНИ("2023-01-30"; 5)'), '2023-02-04');
    // Добавление 1 месяца к 31 января должно корректно обработать конец февраля
    assert.strictEqual(clmFormulaService.evaluate('=ДОБАВИТЬ_МЕСЯЦЫ("2023-01-31"; 1)'), '2023-02-28');
    assert.strictEqual(clmFormulaService.evaluate('=ДОБАВИТЬ_МЕСЯЦЫ("2024-01-31"; 1)'), '2024-02-29'); // Високосный год
});

runTest('РАЗНДАТ (Разница между датами)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=РАЗНДАТ("2023-01-01"; "2023-01-31"; "дни")'), 30);
    assert.strictEqual(clmFormulaService.evaluate('=РАЗНДАТ("2023-01-01"; "2024-01-01"; "месяцы")'), 12);
    assert.strictEqual(clmFormulaService.evaluate('=РАЗНДАТ("2020-01-01"; "2023-01-01"; "годы")'), 3);
});

runTest('РАБ_ДНИ, СЛЕД_РАБ_ДЕНЬ и ПРЕД_РАБ_ДЕНЬ', () => {
    assert.strictEqual(clmFormulaService.evaluate('=РАБ_ДНИ("2023-10-02"; "2023-10-08")'), 5); // Пн-Пт
    assert.strictEqual(clmFormulaService.evaluate('=РАБ_ДНИ("2023-10-07"; "2023-10-08")'), 0); // Сб-Вс
    
    // 2023-10-06 это Пятница. Следующий рабочий день - Понедельник 2023-10-09
    assert.strictEqual(clmFormulaService.evaluate('=СЛЕД_РАБ_ДЕНЬ("2023-10-06")'), '2023-10-09');
    // 2023-10-09 это Понедельник. Предыдущий рабочий день - Пятница 2023-10-06
    assert.strictEqual(clmFormulaService.evaluate('=ПРЕД_РАБ_ДЕНЬ("2023-10-09")'), '2023-10-06');
});

runTest('ДАТА_ПРОПИСЬЮ и ФОРМАТ_ДАТЫ', () => {
    assert.strictEqual(
        clmFormulaService.evaluate('=ДАТА_ПРОПИСЬЮ("2023-01-01")'),
        'первого января две тысячи двадцать третьего года'
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=ФОРМАТ_ДАТЫ("2023-12-31"; "dd.MM.yyyy")'),
        '31.12.2023'
    );
});

// ==========================================
// 5. Финансы, Бухгалтерия и Ответственность
// ==========================================
runTest('ВЫДЕЛИТЬ_НДС, НАЧИСЛИТЬ_НДС и СУММА_С_НДС', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ВЫДЕЛИТЬ_НДС(120; 20)'), 20);
    assert.strictEqual(clmFormulaService.evaluate('=НАЧИСЛИТЬ_НДС(100; 20)'), 20);
    assert.strictEqual(clmFormulaService.evaluate('=СУММА_С_НДС(100; 20)'), 120); // Новая функция: полная сумма
    assert.strictEqual(clmFormulaService.evaluate('=ВЫДЕЛИТЬ_НДС(110; 10)'), 10);
});

runTest('РАССЧИТАТЬ_ПЕНЮ (Неустойка)', () => {
    // 100 000 руб, 10 дней просрочки, 0.1% в день = 100 000 * 10 * 0.001 = 1000
    assert.strictEqual(clmFormulaService.evaluate('=РАССЧИТАТЬ_ПЕНЮ(100000; 10; 0.1)'), 1000);
    // 50 000 руб, 5 дней, 0.5% в день = 50 000 * 5 * 0.005 = 1250
    assert.strictEqual(clmFormulaService.evaluate('=РАССЧИТАТЬ_ПЕНЮ(50000; 5; 0.5)'), 1250);
});

runTest('ФОРМАТ_ВАЛЮТЫ (дробные и отрицательные числа)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ФОРМАТ_ВАЛЮТЫ(1500000; "RUB")'), '1 500 000,00 ₽');
    assert.strictEqual(clmFormulaService.evaluate('=ФОРМАТ_ВАЛЮТЫ(1234.5; "RUB")'), '1 234,50 ₽');
});

runTest('СУММА_ПРОПИСЬЮ (с копейками)', () => {
    const result = clmFormulaService.evaluate('=СУММА_ПРОПИСЬЮ(123.45; "rub")');
    assert.ok(String(result).includes('сто двадцать три'), 'Должно содержать "сто двадцать три"');
    assert.ok(String(result).includes('рубл'), 'Должно содержать "рубл"');
    assert.ok(String(result).includes('сорок пять'), 'Должно содержать "сорок пять"');
    assert.ok(String(result).includes('копе'), 'Должно содержать "копе" (копеек)');
});

// ==========================================
// 6. Извлечение и маскировка данных (CLM Security)
// ==========================================
runTest('МАСКИРОВАТЬ (Скрытие части данных)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=МАСКИРОВАТЬ("1234567890"; 2; 2)'), '12******90');
    assert.strictEqual(clmFormulaService.evaluate('=МАСКИРОВАТЬ("+79502158556"; 2; 2; "*")'), '+7********56');
});

runTest('ИЗВЛЕЧЬ_ПО_ШАБЛОНУ (Regex)', () => {
    // Извлечение 10-значного ИНН из текста
    assert.strictEqual(
        clmFormulaService.evaluate('=ИЗВЛЕЧЬ_ПО_ШАБЛОНУ("ИНН получателя 5503096174; адрес..."; "\\d{10}")'),
        '5503096174'
    );
    // Извлечение группы захвата (например, код города из телефона)
    assert.strictEqual(
        clmFormulaService.evaluate('=ИЗВЛЕЧЬ_ПО_ШАБЛОНУ("Тел: +7 (950) 215-85-56"; "\\+7\\s*\\((\\d{3})\\)"; 1)'),
        '950'
    );
});

// ==========================================
// 7. Логика проверки данных и значения по умолчанию
// ==========================================
runTest('ПУСТО и ЕСЛИ_ПУСТО (Аналог COALESCE)', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ПУСТО("")'), true);
    assert.strictEqual(clmFormulaService.evaluate('=ПУСТО("Текст")'), false);
    assert.strictEqual(clmFormulaService.evaluate('=ПУСТО(null)'), true);
    
    // Подстановка значения по умолчанию
    // ИСПРАВЛЕНИЕ: Убрана лишняя скобка и точка с запятой после функции
    assert.strictEqual(
        clmFormulaService.evaluate('=ЕСЛИ_ПУСТО(""; "Не указано")'), 
        'Не указано'
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=ЕСЛИ_ПУСТО("Иванов"; "Не указано")'),
        'Иванов'
    );
    // Проверка цепочки подстановки
    assert.strictEqual(
        clmFormulaService.evaluate('=ЕСЛИ_ПУСТО(null; ""; "Конечное значение")'),
        'Конечное значение'
    );
});

// ==========================================
// 8. Контекст, переменные и предобработка
// ==========================================
runTest('Использование переменных из контекста', () => {
    const context = { Sum: 100000, Rate: 20, Name: "Тест" };
    assert.strictEqual(
        clmFormulaService.evaluate('=СУММ(Sum; НАЧИСЛИТЬ_НДС(Sum; Rate))', context),
        120000
    );
    assert.strictEqual(
        clmFormulaService.evaluate('=СЦЕПИТЬ("Имя: "; Name)', context),
        'Имя: Тест'
    );
});

runTest('Предобработка: запятые в дробных числах и точки с запятой', () => {
    assert.strictEqual(clmFormulaService.evaluate('=СУММ(1,5; 2,5)'), 4);
    assert.strictEqual(clmFormulaService.evaluate('=ОКРУГЛ(3,1415; 2)'), 3.14);
});

runTest('Предобработка: булевы значения ИСТИНА/ЛОЖЬ', () => {
    assert.strictEqual(clmFormulaService.evaluate('=ЕСЛИ(ИСТИНА; "Да"; "Нет")'), 'Да');
    assert.strictEqual(clmFormulaService.evaluate('=ЕСЛИ(ЛОЖЬ; "Да"; "Нет")'), 'Нет');
});

// ==========================================
// 9. Обработка ошибок и граничные случаи
// ==========================================
runTest('Возврат #VALUE! при некорректных данных', () => {
    assert.strictEqual(clmFormulaService.evaluate('=СКЛОНЯТЬ_ФИО("Иванов"; "Иван"; ""; "неизвестный_падеж")'), '#VALUE!');
    assert.strictEqual(clmFormulaService.evaluate('=ДОБАВИТЬ_ДНИ("не дата"; 5)'), '#VALUE!');
    assert.strictEqual(clmFormulaService.evaluate('=ВЫДЕЛИТЬ_НДС("текст"; 20)'), '#VALUE!');
    assert.strictEqual(clmFormulaService.evaluate('=ВЫДЕЛИТЬ_НДС(100)'), '#VALUE!'); // Не хватает аргумента rate
});

// Итоги
console.log('\n' + '='.repeat(60));
console.log(`🏁 ИТОГО: ✅ Пройдено: ${passed} | ❌ Провалено: ${failed}`);
console.log('='.repeat(60));

if (failed > 0) {
    console.log('⚠️ Некоторые тесты провалены! Проверьте вывод выше для отладки.');
    process.exit(1);
} else {
    console.log('🎉 Все тесты успешно пройдены! CLMFormulaService работает корректно.');
}