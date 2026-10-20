-- SPDX-FileCopyrightText: 2026 Andrey Soloduhin
--
-- SPDX-License-Identifier: Apache-2.0

-- Отключаем проверку внешних ключей для безопасной вставки в любом порядке
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM notifications;
DELETE FROM document_set_access;
DELETE FROM review_edits;
DELETE FROM comments;
DELETE FROM task_history;
DELETE FROM task_attachments;
DELETE FROM approval_stages;
DELETE FROM tasks;
DELETE FROM condition_formulation_variants;
DELETE FROM formulation_versions;
DELETE FROM formulations;
DELETE FROM formulation_groups;
DELETE FROM formulation_types;
DELETE FROM questionnaire_answers;
DELETE FROM condition_rules;
DELETE FROM condition_rule_groups;
DELETE FROM questionnaire_conditions;
DELETE FROM questionnaire_properties;
DELETE FROM questionnaire_sections;
DELETE FROM document_anchors;
DELETE FROM document_blocks;
DELETE FROM document_versions;
DELETE FROM documents;
DELETE FROM document_sets;
DELETE FROM folders;
DELETE TABLE users;

-- ==========================================
-- 1. ПОЛЬЗОВАТЕЛИ
-- ==========================================
INSERT INTO users (id, email, password_hash, first_name, last_name, middle_name, avatar_url, is_active, created_at, updated_at) VALUES
(1, 'sandys133@yandex.ru', '$2b$12$mock_hash_for_sandys133', 'Иван', 'Иванов', 'Иванович', 'https://i.pravatar.cc/150?u=sandys133', 1, NOW(), NOW()),
(2, 'petrov@company.ru', '$2b$12$mock_hash_petrov', 'Петр', 'Петров', 'Петрович', 'https://i.pravatar.cc/150?u=petrov', 1, NOW(), NOW()),
(3, 'smirnova@company.ru', '$2b$12$mock_hash_smirnova', 'Ольга', 'Смирнова', 'Владимировна', 'https://i.pravatar.cc/150?u=smirnova', 1, NOW(), NOW()),
(4, 'kozlov@company.ru', '$2b$12$mock_hash_kozlov', 'Дмитрий', 'Козлов', '', 'https://i.pravatar.cc/150?u=kozlov', 1, NOW(), NOW());

-- ==========================================
-- 2. ФАЙЛОВАЯ СИСТЕМА (ПАПКИ)
-- ==========================================
INSERT INTO folders (id, parent_id, name, owner_id, is_deleted, created_at, updated_at) VALUES
(1, NULL, 'Договоры 2024', 1, 0, NOW(), NOW()),
(2, NULL, 'Шаблоны ЮО', 1, 0, NOW(), NOW()),
(3, 1, 'Архив', 1, 0, NOW(), NOW());

-- ==========================================
-- 3. КОМПЛЕКТЫ ДОКУМЕНТОВ (ENUM: mode, approval_status)
-- ==========================================
INSERT INTO document_sets (id, folder_id, name, mode, is_questionnaire_enabled, approval_status, owner_id, is_favorite, is_deleted, created_at, updated_at) VALUES
(1, 1, 'Договор оказания услуг_v3.docx', 'template ', 1, 'in_approval ', 1, 1, 0, NOW(), NOW()), 
(2, 1, 'Договор поставки №45', 'standard ', 0, 'approved ', 1, 0, 0, NOW(), NOW()),             
(3, 2, 'НДА с ООО Техпром', 'standard ', 0, 'draft ', 1, 0, 0, NOW(), NOW()),                   
(4, 3, 'Старый договор', 'standard ', 0, 'rejected ', 1, 0, 1, NOW(), NOW());                   

-- ==========================================
-- 4. ДОКУМЕНТЫ, ВЕРСИИ, БЛОКИ И ЯКОРЯ (ENUM: document_role, block_type, anchor_type)
-- ==========================================
INSERT INTO documents (id, document_set_id, name, document_role, sort_order, created_at, updated_at) VALUES
(1, 1, 'Договор оказания услуг', 'main ', 1, NOW(), NOW()),
(2, 1, 'Приложение №1 (ТЗ)', 'appendix ', 2, NOW(), NOW());

INSERT INTO document_versions (id, document_id, version_number, content_json, content_html, author_id, is_current, created_at) VALUES
(1, 1, 1, '{"type":"doc","content":[{"type":"paragraph","text":"Старая версия"}]}', '<p>Старая версия</p>', 1, 0, NOW() - INTERVAL 2 DAY),
(2, 1, 2, '{"type":"doc","content":[{"type":"paragraph","attrs":{"uuid":"block_1"},"content":[{"type":"text","text":"Срок оказания услуг: 30 дней."}]}]}', '<p>Срок оказания услуг...</p>', 1, 1, NOW() - INTERVAL 1 DAY);

INSERT INTO document_blocks (id, document_version_id, block_uuid, block_type, block_path, sort_order) VALUES
(1, 2, 'block_1', 'paragraph ', '0', 1);

INSERT INTO document_anchors (id, document_version_id, block_uuid, anchor_uuid, anchor_type, text_content, char_offset, char_length) VALUES
(1, 2, 'block_1', 'anc_1', 'word ', 'Срок оказания услуг', 0, 19);

-- ==========================================
-- 5. АНКЕТА (ENUM: data_type, value_source, logical_operator, operator)
-- ==========================================
INSERT INTO questionnaire_sections (id, document_set_id, name, sort_order, created_at, updated_at) VALUES
(1, 1, 'Основные положения', 1, NOW(), NOW()),
(2, 1, 'Стоимость и порядок расчетов', 2, NOW(), NOW());

INSERT INTO questionnaire_properties (id, document_set_id, section_id, name, identifier, data_type, is_required, hide_in_form, value_source, format, sort_order, created_at, updated_at) VALUES
(1, 1, 1, 'Название компании', 'company_name', 'text ', 1, 0, 'user_input ', '{value}', 1, NOW(), NOW()),
(2, 1, 2, 'Сумма договора', 'contract_sum', 'money ', 1, 0, 'user_input ', '{value} руб.', 2, NOW(), NOW());

INSERT INTO questionnaire_conditions (id, document_set_id, section_id, name, is_enabled_default, sort_order, created_at) VALUES
(1, 1, 2, 'Включать НДС?', 1, 3, NOW());

INSERT INTO condition_rule_groups (id, condition_id, parent_group_id, logical_operator, sort_order) VALUES
(1, 1, NULL, 'AND ', 1);

INSERT INTO condition_rules (id, group_id, property_id, operator, compare_value, sort_order) VALUES
(1, 1, 2, '>=', '100000', 1);

-- ==========================================
-- 6. БИБЛИОТЕКА ФОРМУЛИРОВОК
-- ==========================================
INSERT INTO formulation_types (id, name, owner_id, sort_order) VALUES
(1, 'Стандартные', 1, 1),
(2, 'Специальные', 1, 2);

INSERT INTO formulation_groups (id, name, owner_id, created_at, updated_at) VALUES
(1, 'Общие положения', 1, NOW(), NOW());

INSERT INTO formulations (id, type_id, group_id, name, is_favorite, current_version_id, created_by, created_at, updated_at) VALUES
(101, 1, 1, 'Ответственность сторон', 1, 1001, 1, NOW(), NOW()),
(102, 1, 1, 'Порядок расчётов', 0, 1002, 2, NOW(), NOW());

INSERT INTO formulation_versions (id, formulation_id, version_number, text_content, author_id, is_current, created_at) VALUES
(1001, 101, 1, 'За неисполнение обязательств Стороны несут ответственность...', 1, 1, NOW()),
(1002, 102, 1, 'Оплата производится в рублях...', 2, 1, NOW());

INSERT INTO condition_formulation_variants (id, condition_id, formulation_id, formulation_version_id, is_fallback, document_set_id, identifier, created_at, updated_at) VALUES
(1, 1, 101, 1001, 0, 1, 'formulation_nds', NOW(), NOW());

-- ==========================================
-- 7. ЗАДАЧИ И МАРШРУТЫ (ENUM: task_type, status, route_type, access_level, action)
-- ==========================================
INSERT INTO tasks (id, parent_task_id, document_set_id, name, description, task_type, status, initiator_id, assignee_id, deadline, route_type, created_at, updated_at) VALUES
(1, NULL, 1, 'Согласовать договор оказания услуг', 'Проверить договор на соответствие стандартам', 'approval ', 'in_review ', 1, 1, CURDATE() + INTERVAL 5 DAY, 'sequential ', NOW(), NOW()),
(2, 1, 1, 'Этап 1: Юридический отдел', NULL, 'approval ', 'completed ', 1, 3, CURDATE() + INTERVAL 5 DAY, 'sequential ', NOW(), NOW()),
(3, 1, 1, 'Этап 2: Инициатор (Вы)', NULL, 'approval ', 'in_review ', 1, 1, CURDATE() + INTERVAL 5 DAY, 'sequential ', NOW(), NOW()), 
(4, 1, 1, 'Этап 3: Финансовый директор', NULL, 'approval ', 'pending ', 1, 4, CURDATE() + INTERVAL 5 DAY, 'sequential ', NOW(), NOW());

INSERT INTO approval_stages (id, task_id, stage_number, assignee_id, access_level, status, comment, completed_at, created_at) VALUES
(1, 1, 1, 3, 'review ', 'approved ', 'Реквизиты проверены, одобряю', NOW() - INTERVAL 1 HOUR, NOW()),
(2, 1, 2, 1, 'full ', 'in_progress ', NULL, NULL, NOW()),
(3, 1, 3, 4, 'review ', 'not_started ', NULL, NULL, NOW());

INSERT INTO task_history (id, task_id, root_task_id, user_id, action, comment, created_at) VALUES
(1, 1, 1, 1, 'created ', 'Задача создана', NOW() - INTERVAL 2 DAY),
(2, 1, 1, 1, 'sent_for_approval ', 'Отправлено на согласование', NOW() - INTERVAL 1 DAY),
(3, 1, 1, 3, 'approved ', 'Юр. отдел согласовал', NOW() - INTERVAL 1 HOUR);

INSERT INTO task_attachments (id, task_id, document_version_id, attached_by, created_at) VALUES
(1, 1, 2, 1, NOW());

-- ==========================================
-- 8. РЕЦЕНЗИРОВАНИЕ (ENUM: edit_type, resolution_status)
-- ==========================================
INSERT INTO comments (id, document_version_id, task_id, parent_comment_id, block_uuid, anchor_uuid, text_content, author_id, is_resolved, is_orphan, created_at, updated_at) VALUES
(1, 2, 1, NULL, 'block_1', 'anc_1', 'Необходимо уточнить сроки оказания услуг.', 2, 0, 0, NOW() - INTERVAL 30 MINUTE, NOW() - INTERVAL 30 MINUTE),
(2, 2, 1, 1, 'block_1', 'anc_1', 'Согласен, исправлю. Срок — 30 рабочих дней.', 1, 0, 0, NOW() - INTERVAL 15 MINUTE, NOW() - INTERVAL 15 MINUTE);

INSERT INTO review_edits (id, document_version_id, task_id, edit_type, old_text, new_text, block_uuid, author_id, resolution_status, is_orphan, created_at) VALUES
(1, 2, 1, 'replacement ', '30 дней', '30 рабочих дней', 'block_1', 2, 'pending ', 0, NOW() - INTERVAL 20 MINUTE);

-- ==========================================
-- 9. ДОСТУПЫ И УВЕДОМЛЕНИЯ (ENUM: access_type, type)
-- ==========================================
INSERT INTO document_set_access (id, document_set_id, user_id, access_type, granted_by, created_at) VALUES
(1, 2, 2, 'review ', 1, NOW());

INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES
(1, 1, 'comment_added ', 'Новый комментарий', 'Петров П.П. оставил комментарий к договору', 0, NOW() - INTERVAL 30 MINUTE),
(2, 1, 'task_assigned ', 'Задача на согласование', 'Вам назначена задача на Этапе 2 согласования', 0, NOW() - INTERVAL 1 HOUR);

-- Включаем проверку внешних ключей обратно
SET FOREIGN_KEY_CHECKS = 1;