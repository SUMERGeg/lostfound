# Карта персональных данных Lost&Found

Дата фиксации: 13 августа 2026 г. Эта карта описывает фактический код и не заменяет реестр/уведомление оператора.

| Категория | Конкретные поля | Источник | Хранилище/получатель | Доступ сейчас | Жизненный цикл сейчас | Требуемое решение |
|---|---|---|---|---|---|---|
| Аккаунт | email, display name, phone, Telegram, password hash, role, status, verified time | пользователь, администратор | MySQL `users` | сам пользователь; admin видит ограниченное представление | email/имя/контакты очищаются при delete; строки и UUID остаются | срок неактивного аккаунта, допустимость анонимизации вместо hard delete |
| Refresh-сессия | token hash, family ID, User-Agent, expiry/revoked | сервер, браузерный header | MySQL `refresh_sessions`; raw token — HttpOnly cookie | auth service | истёкшие/отозванные строки не очищаются планово | срок и cleanup; нужна ли история устройств |
| Action tokens | token hash, purpose, expiry, used time | сервер | MySQL verification/reset tables; raw token — email URL/браузер | email-провайдер и владелец ссылки | single-use, но нет cleanup job | cleanup и безопасный URL exchange |
| Объявление | author ID, type, category, title, description, exact lat/lng, district, time, status | пользователь | MySQL `listings`; DTO в браузере | контент, exact coords и фото публичны | active listing закрывается при account delete, строка остаётся | публичная точность координат и сроки хранения закрытых объявлений |
| Фото | image bytes, object key, public URL, MIME, size, SHA-256, owner/listing IDs | пользователь | S3 + MySQL `uploads`/`photos`; CDN/browser cache | URL публичен | PENDING cleanup 24h; ATTACHED бессрочно; account delete не удаляет | EXIF stripping, cache invalidation, hard-delete SLA |
| Owner check | holder/claimant IDs, status, timestamps | участники | MySQL `owner_checks` | участники; служебный backend | срока очистки нет | срок спора/доказательства и анонимизация |
| Вопросы и ответы | question/prompt snapshot, plaintext answer | владелец, заявитель | MySQL `owner_questions`, `owner_answers` | участники проверки по текущим правилам | срока очистки нет, account delete не очищает | срок, видимость каждому участнику, шифрование/удаление |
| Раскрытые контакты | snapshot email/phone/Telegram | профиль участника при approval | MySQL `owner_check_contacts` | оба участника approved check | нет срока/отзыва, account delete не очищает | каналы opt-in, срок, отзыв и повторное раскрытие |
| Чаты | membership, body, metadata, timestamps | пользователи/система | MySQL `chats`, `chat_members`, `messages` | участники | retention не задан | срок, удаление автора, доказательная ценность жалоб |
| Уведомления | body, JSON payload, user ID | система | MySQL `notifications` | адресат | retention не задан | срок и исключение контактных snapshot из payload |
| Email outbox | email, displayName, token ID, template, error | система | MySQL outbox + email-провайдер | worker/оператор БД/провайдер | completed/failed rows не очищаются планово | срок, DPA/локализация провайдера, redaction ошибок |
| Матчи/feedback | listing IDs, user IDs, решение/feedback | система, пользователь | MySQL | участники через API | retention не задан | срок после закрытия/удаления объявления |
| Жалобы | reporter/author IDs и emails в admin DTO, reason, details, note | пользователь, администратор | MySQL `reports` | администраторы | retention не задан | срок для защиты сервиса и анонимизация сторон |
| Обращения по персональным данным | user ID, email, тип, текст, статус, служебная заметка | пользователь или посетитель, администратор | MySQL `privacy_requests` | администраторы | retention не задан | проверка личности, SLA и срок хранения; при удалении аккаунта содержание обезличивается |
| Audit log | actor/target IDs, action, metadata, time | администратор/система | MySQL `audit_log` | прямого API чтения нет | retention не задан | срок, неизменяемость, право доступа/выгрузки |
| IP rate limit | IP/subject key, count, reset time | сетевое соединение | память процесса | backend | ключи не имеют глобальной эвакуации | shared bounded TTL, хранить ли хэшированный IP в security events |
| Карта | exact coordinates + browser/network metadata | публичный DTO и браузер | Yandex Maps JS API | сторонний провайдер | определяется провайдером, в проекте не зафиксировано | договор/политика, локализация, публичная точность |

## Потоки данных

1. Пользователь → nginx/API → MySQL: аккаунт, объявление, проверки, сообщения и жалобы.
2. Пользователь → API → S3: изображения; API сохраняет публичный URL и metadata в MySQL.
3. API/outbox → email-провайдер → пользователь: адрес, письмо и action link.
4. API → браузер → Yandex Maps: публичные координаты и обычные сетевые данные браузера.
5. Администратор → admin API → MySQL: модерационное решение и audit event.

## Пробелы жизненного цикла

В коде нет единой retention policy, scheduler не очищает большинство истёкших auth/outbox/domain записей, резервные копии не описаны, удаление S3 после account deletion отсутствует. Все сроки должны сначала появиться в [owner-decisions-required.md](./owner-decisions-required.md), затем в миграциях, cron/jobs, тестах и эксплуатационной инструкции.
