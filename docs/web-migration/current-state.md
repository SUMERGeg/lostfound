# Lost&Found: текущее состояние перед standalone web-миграцией

Дата аудита: 12 августа 2026 года. Репозиторий: `https://github.com/SUMERGeg/lostfound`, ветка `main`, исходный commit `b435c27`.

## 1. Краткий вывод

Проект является работающим хакатонным MVP: React/Vite Mini App, Express API, MySQL и MAX Bot. Публичные лента, карточка и карта уже открываются в обычном браузере, но создание и изменение объявлений, owner-check, контакты, уведомления и волонтёрский сценарий реализованы преимущественно внутри MAX Bot FSM.

Миграцию можно выполнить без переписывания с нуля, если сначала извлечь бизнес-операции из `server/src/fsm.js` в обычные services/use-cases, покрыть существующее поведение тестами и только после этого подключить web routes.

Главные текущие ограничения:

- собственной web-аутентификации нет;
- публичный API доверяет переданному клиентом `authorId` и не проверяет ownership;
- большая часть domain logic находится в MAX-specific FSM размером более 5 300 строк;
- DDL создаётся одним `CREATE TABLE IF NOT EXISTS` script без versioned migrations и foreign keys;
- фото — URL/MAX attachment token, Object Storage upload flow отсутствует;
- matching прост и не версионируется;
- тестов до аудита не было;
- в Git были закоммичены `.env`, MAX bot token и browser key Яндекс.Карт.

## 2. Текущая архитектура

```text
                         MAX client
                             |
              commands / callbacks / attachments
                             v
React 18 / Vite -----> Express 5 + MAX Bot/FSM -----> MySQL 8
  feed, card, map       listings API, cron, bot       11 tables
        |                       |
        +---- Yandex Maps 2.1   +---- MAX Bot API
```

### Frontend

- `client/src/main.jsx`: React bootstrap, `BrowserRouter`, MAX UI provider.
- `client/src/App.jsx`: общий layout, навигация, фильтры, ссылка VK Добро.
- `client/src/pages/Home.jsx`: публичная лента через `GET /listings`.
- `client/src/pages/Map.jsx`: Яндекс.Карты, clusterer и markers; получает до 200 записей без bbox текущего viewport.
- `client/src/pages/Listing.jsx`: публичная карточка.
- `client/src/components/Filters.jsx`: фильтры type/category.
- `client/src/utils/maxBridge.js`: `window.WebApp`, init data и platform buttons, но сейчас не импортируется остальным клиентом.
- `client/index.html`: подключает MAX Bridge и Яндекс.Карты.
- `client/vercel.json`: разрешает embedding из MAX/VK domains и содержит MAX/VK-specific CSP.

React-приложение уже использует browser routing и имеет прямые URL `/`, `/map`, `/listing/:id`. Оно пригодно как основа standalone web, но продуктовые actions почти полностью отсутствуют.

### Backend

- `server/src/index.js`: Express composition root; `/health`, `/listings`, `/webhook`; всегда запускает matching cron и при наличии token запускает MAX Bot.
- `server/src/listings.js`: публичные list/detail/create/close endpoints.
- `server/src/fsm.js`: создание LOST/FOUND, category attributes, time/location/photo/secrets, matching actions, owner-check, contact exchange, notifications, my listings/editing и volunteer flow.
- `server/src/max.js`: `@maxhub/max-bot-api`, commands/events, MAX message delivery.
- `server/src/chat.js`: persistence helper для owner-check/dialog chats.
- `server/src/notifications.js`: in-DB notifications CRUD helpers.
- `server/src/matching.js`: current score function.
- `server/src/cron.js`: all-pairs matching каждые 10 минут.
- `server/src/security.js`: AES-256-GCM для owner-check secrets, но при отсутствии/ошибке key разрешает plaintext fallback.
- `server/src/migrate.js`: не versioned migration, а идемпотентное создание таблиц.
- `server/src/db.js`: MySQL pool.

## 3. Фактический HTTP API

| Метод | Route | Текущее поведение | Риск/пробел |
|---|---|---|---|
| GET | `/health` | `{ok:true}` | Не проверяет DB/storage; нет readiness |
| GET | `/listings` | active feed, type/category, грубый bounding box, limit | Нет валидации/пагинации; limit может быть произвольным; radius box неверно учитывает longitude |
| GET | `/listings/:id` | listing + photo URLs | Возвращает всю строку `listings`; public DTO не формализован |
| POST | `/listings` | создаёт listing/photos/secrets | Нет auth; доверяет `authorId`; нет transaction/validation; принимает произвольные URLs и plaintext secrets |
| PATCH | `/listings/:id/close` | закрывает listing | Нет auth/ownership; любой клиент может закрыть любое объявление |
| POST/GET | `/webhook` | MAX updates/health | Ошибки обработки скрываются за HTTP 200 |

`swagger.json` в корне — спецификация MAX Bot API, а не Lost&Found API. Документ `lostfound-openapi.yaml` из docs-репозитория — полезный черновик, но не соответствует этому backend и должен быть перенесён/актуализирован как `/api/v1`.

## 4. Полный список MAX-зависимостей

### Package/runtime

- `server/package.json`: `@maxhub/max-bot-api`.
- `client/package.json`: `@maxhub/max-ui`.
- `client/src/main.jsx`: `MaxUI` provider и MAX UI stylesheet.
- `client/index.html`: `https://st.max.ru/js/max-web-app.js`.
- `client/src/utils/maxBridge.js`: `window.WebApp`, `InitData/initData`, `initDataUnsafe.user`, close/MainButton/ready/expand и `/auth` с initData.

### Backend startup and delivery

- `server/src/index.js`: import/start `startBot`, `MAX_BOT_TOKEN` startup gate, `/webhook` mount.
- `server/src/max.js`: Bot construction, commands, `bot_started`, `message_created`, `message_callback`, contact capture и send-to-user.
- `server/src/webhook.js`: MAX webhook adapter.
- `server/src/polling.js`: альтернативный direct `/updates` polling; импортирует несуществующий `handleBotEvent`, поэтому этот файл является stale/broken path и не вызывается `index.js`.
- `server/src/fsm.js`: MAX context (`ctx.reply`, callback answers, inline keyboards, attachments), send through MAX, platform URLs.

### Identity/contact IDs

- `server/src/migrate.js`: `users.max_id UNIQUE NOT NULL`.
- `server/src/users.js`: `ensureUser(maxUserId)` и phone из MAX contact.
- `server/src/chat.js`: join с `users.max_id`.
- `server/src/fsm.js`: identity fallback из `ctx.user`, sender, `ctx.chatId`, callback/update; уведомления получают `max_id`; contacts состоят из `max_id` и phone.
- `server/src/seed.js`: demo `max.demo.*` identities.

### Bot-only business UI

`server/src/fsm.js` реализует через MAX:

- main menu/commands/callback keyboards;
- создание/preview/публикацию LOST и FOUND;
- category-specific attributes;
- загрузку photo attachments;
- request/send location;
- owner-check questions/answers/review;
- запрос и раскрытие phone/MAX contacts;
- notifications display/actions;
- my listings, editing and status changes;
- volunteer selection/assignment.

### Attachments, geo and external artifacts

- `extractPhotoAttachments`, `extractPhotoUrl`: MAX attachments и `max-photo-token:*`.
- `extractLocationAttachment`: MAX location attachment.
- `button.requestContact`: MAX contact request.
- `swagger.json`: MAX Bot API specification; не использовать как product OpenAPI.
- `client/vercel.json`: MAX/VK embedding allowlist.
- README/requirements branding and setup assume MAX.

## 5. Фактическая БД

`server/src/migrate.js` создаёт 11 MySQL tables:

| Таблица | Назначение | Состояние для web |
|---|---|---|
| `users` | internal UUID, mandatory `max_id`, phone | Расширить email/password/status/role; `max_id` сделать nullable legacy mapping, затем удалить |
| `listings` | LOST/FOUND, category, content, geo, status | Переиспользовать и постепенно нормализовать в advertisements |
| `photos` | listing + URL | Заменить на upload/object metadata и ownership |
| `secrets` | owner-check question/answer payload | Мигрировать в owner questions/answers; запретить plaintext fallback |
| `matches` | lost/found pair + integer score | Добавить algorithm version, breakdown, timestamps/status |
| `chats` | owner-check/dialog aggregate | Переиспользовать данные для claims только после mapping; chat вне beta scope |
| `chat_members` | claimant/holder/observer | Частично reusable для migration participants |
| `chat_messages` | messages/owner-check artifacts | Извлечь только owner-check evidence; обычный chat вне scope |
| `notifications` | in-app model, сейчас bot-oriented | Переиспользовать после удаления chat/MAX coupling |
| `volunteer_assignments` | volunteer flow | Изолировать/out of production scope |
| `states` | persistent bot FSM state | Не использовать для web; удалить после parity and migration |

В DDL нет foreign keys, check constraints или migration history. Нет refresh sessions, email verification/reset, contacts snapshots, match feedback, reports, audit log или email outbox.

## 6. Matching: текущая формула

Файл: `server/src/matching.js`.

```text
score = category + time + geo + title

category = 25, если category совпадает, иначе 0
time     = max(0, 20 - min(20, floor(abs(hours difference) / 6)))
geo      = 30 при distance <= 0.3 km
           20 при distance <= 1 km
           10 при distance <= 3 km
            0 иначе
title    = min(25, 5 * число tokens из found.title,
                        встречающихся в lost.title)
```

Максимальный score — 100. `server/src/cron.js` каждые 10 минут читает все ACTIVE LOST и FOUND, делает Cartesian product и сохраняет пары с `score >= 70`.

Подтверждённые особенности/дефекты:

- category не является hard candidate filter;
- description и structured attributes не участвуют;
- повторяющиеся tokens в found title считаются несколько раз;
- missing/invalid date может сделать итог `NaN`;
- missing/invalid coordinates не обрабатываются явно;
- cron имеет O(L×F), читает все rows и последовательно вставляет matches;
- пустой `catch` скрывает не только duplicate pair, но и реальные DB failures;
- existing pair никогда не обновляет score;
- нет `algorithm_version`, breakdown, feedback и notification hook.

Во время аудита добавлены characterization tests в `server/test/matching.test.js`; они фиксируют текущие weights/buckets и известный missing-date defect до улучшения алгоритма.

## 7. Upload flow

Фактического web upload нет.

- Web API принимает массив произвольных URL в `POST /listings`.
- Bot flow извлекает MAX photo ID/token/URL из message attachments.
- `photos.url` может содержать `max-photo-token:*`.
- Нет MIME/magic-byte validation, size/count validation на backend, unique object keys, user ownership, temporary uploads, cleanup или Object Storage adapter.
- Demo photos лежат в `client/public/sample`.

Значит reusable только связь listing→photos и UI отображения URL; transport/storage нужно заменить.

## 8. Map and geolocation

Переиспользуемо:

- `client/src/pages/Map.jsx`: Яндекс.Карты 2.1, clusterer, LOST/FOUND/category markers, HTML escaping, переход в карточку;
- `listings` lat/lng и type/category filters;
- UI карточек и filter metadata.

Требует переработки:

- key был зашит в `client/index.html`; переносится в env и должен иметь domain restrictions;
- map загружает до 200 объявлений независимо от viewport;
- server `radius` реализован square bounding box с одинаковым degree delta для latitude/longitude;
- нет center requirement при radius, pagination, PostGIS или exact distance;
- создание/редактирование точки есть только через MAX location attachment;
- Web Geolocation/manual map picker отсутствуют;
- public coordinate privacy policy отсутствует.

## 9. Owner-check, contacts and notifications

Исполняемая логика есть и её важно сохранить:

- pair orientation LOST→FOUND;
- создание `OWNER_CHECK` chat и participant roles;
- вопросы из encrypted listing secrets;
- последовательный сбор answers;
- holder review APPROVE/DECLINE;
- state/status transitions PENDING→ACTIVE/DECLINED→CLOSED;
- contact exchange request/share sequence;
- permission checks на участника при bot callbacks;
- in-app-like notification records and statuses.

Но persistence смешивает claim, chat, questions/answers и transient FSM payload. Для standalone beta нужно извлечь state machine/use-cases и хранить claims/questions/answers отдельно. После APPROVED отдельный endpoint должен отдавать только ad contact snapshot; обычный chat не переносить.

## 10. Что можно переиспользовать

### Frontend

- Vite/React bootstrap и BrowserRouter;
- responsive CSS/layout foundations;
- feed, listing detail, filters;
- map, clusterer, marker presentation;
- category/type metadata;
- API fetch patterns после замены единым client module.

### Backend/domain

- Express 5 application как временная основа;
- MySQL pool/repository queries для expand/contract migration;
- listing fields/status semantics;
- Haversine and matching weights как characterized baseline;
- category attributes, date parsing and preview logic из FSM;
- owner-check roles/transitions/notifications concepts;
- AES-GCM format только для controlled legacy decrypt/migration (не с plaintext fallback);
- Docker Compose для local development после удаления committed credentials.

## 11. Что требует rewrite/extraction

- `server/src/fsm.js`: разделить на domain/application services и thin legacy MAX adapter.
- `server/src/listings.js`: versioned API, auth-derived user, validation, ownership, transactions and error handling.
- `server/src/migrate.js`: заменить versioned migrations.
- `server/src/users.js`: internal identity + email auth.
- `server/src/cron.js`: isolated matching job with idempotent upsert and error reporting.
- `server/src/security.js`: startup fail-fast for required encryption; token/password crypto separate.
- `client/src/main.jsx`/`App.jsx`: удалить MAX runtime/UI dependency, добавить routes/auth/layouts.
- upload, profile, email worker, reports/admin and production deployment: создать.

## 12. Security and operational findings

1. Реальный или правдоподобный MAX token находился в tracked `server/.env`, `server/.env.example` и README, начиная минимум с commits `9771995`/`530e543`. Он удалён из текущего worktree, но должен быть немедленно отозван/rotated; Git history остаётся скомпрометированной.
2. Browser key Яндекс.Карт находился в `client/index.html`. Он переносится в env; старый key следует rotate/restrict по domain/referrer/quota.
3. `server/.env` и `client/.env` были tracked. Они удалены, `.gitignore` исправлен; examples сохранены.
4. Public mutation API не имеет auth/ownership.
5. Нет rate limiting, request validation, centralized error handler, structured logger или security headers backend.
6. CORS credentials disabled; это придётся изменить для HttpOnly refresh cookie с точным allowlist.
7. Secret answers могут храниться plaintext, если key отсутствует.
8. `webhook.js` возвращает success при processing failure.
9. Нет foreign keys; orphan/corrupt relations возможны.
10. Нет integration/E2E/security tests.

## 13. Baseline verification

После клонирования:

- server: 16 source files прошли `node --check`;
- client: production Vite build проходит;
- client lint изначально имел 5 errors (`ymaps` global) и 2 hook warnings;
- tests отсутствовали;
- production dependency audit на момент проверки сообщил 0 известных vulnerabilities; первоначальный install summary включал dev-tool advisory counts, поэтому CI должен запускать полный audit отдельно от production-only gate.

Первый stabilization increment:

- удалил tracked local `.env` files и credential values из examples/README;
- добавил matching characterization tests (5 tests);
- исправил map global/lifecycle и hook lint без изменения пользовательского сценария;
- вынес транзакционное создание listing/photos/secrets в общий `server/src/listingService.js`, который теперь вызывают REST и legacy MAX FSM;
- добавил 4 tests listing service: commit, rollback, validation и сохранение лимита 3 фото/3 секрета;
- сохранил проходящую production build.

## 14. Риски и безопасные решения

- **Не удалять FSM сразу.** Сначала extract use-cases + tests, затем web controllers, затем thin legacy adapter, и только после parity удалить MAX.
- **Не мигрировать MySQL и identity одним big-bang.** Добавить новые users/session columns/tables, backfill mapping, dual-read/controlled cutover, constraints, затем удалить `max_id` dependency.
- **Не считать `chats` готовой моделью claim.** Сначала migration mapping и state transition tests.
- **Не улучшать matching до baseline tests.** Characterization tests уже добавлены; следующий шаг — вынести scoring breakdown без изменения threshold.
- **Не раскрывать contacts через `GET /listings/:id`.** Только отдельный protected endpoint после approved owner-check.
- **Volunteer flow изолировать, не переписывать.** Он остаётся вне production routes/build scope.

## 15. Следующий безопасный этап

Продолжить extraction listing service: перенести update/close/photo replacement из `server/src/fsm.js`, добавить auth-derived ownership boundary и только затем строить `/api/v1/ads`. MySQL и legacy MAX adapter пока сохраняются.

## 16. Состояние после первого implementation slice

На 12 августа 2026 реализованы versioned MySQL migrations, standalone browser shell без MAX UI/Bridge, email/password registration и login, короткоживущий JWT, ротируемые HttpOnly refresh sessions, logout, профиль/soft-delete, rate limits, auth-derived ownership и canonical `/api/v1/ads` с OpenAPI. Публичный detail DTO больше не использует `SELECT *` и не содержит owner identity/contacts.

Проверки: 29 server unit tests проходят; client ESLint и production Vite build проходят; server source/migration/test syntax и `git diff --check` проходят. Реальная migrate/HTTP integration против MySQL в этом slice не запускалась, поэтому это остаётся обязательным staging gate.

MAX остаётся только в backend legacy adapter для ещё не перенесённых owner-check/notifications и не участвует в запуске browser frontend. Для beta всё ещё нужны password reset/email delivery, secure Object Storage uploads, web owner-check/contacts, matches/feedback, notifications, admin/moderation и production deployment.

Второй slice добавил web profile и полный lifecycle собственных объявлений, а также secure S3-compatible upload flow. Проверки обновлены до 38 server unit tests; client lint/build и production-only npm audit проходят, audit сообщает 0 известных vulnerabilities. Интеграция с реальным Object Storage и MySQL остаётся staging gate, потому что credentials/сервисы в локальном окружении не настроены.
