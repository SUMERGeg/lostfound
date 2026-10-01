# Lost&Found: implementation plan standalone web

Дата: 12 августа 2026 года. План основан на аудите commit `b435c27`.

## Правила

- MySQL и MAX adapter временно сохраняются, пока web replacement не покрыт тестами.
- `server/src/fsm.js` уменьшается через extraction, а не переписывается целиком.
- Каждый API increment обновляет frontend и canonical OpenAPI.
- Любая схема — versioned migration; destructive changes только expand/contract.
- Contacts deny-by-default; raw tokens/passwords/contacts не логируются.
- Volunteer и собственный chat исключены из beta scope.

## Этап 0. Stabilization and characterization

**Цель:** зафиксировать безопасную точку старта и убрать очевидные repository hazards.

**Файлы:** `.gitignore`, `README.md`, `client/.env*`, `server/.env*`, `client/index.html`, `client/src/pages/Map.jsx`, `client/src/components/Filters.jsx`, `server/package.json`, `server/test/matching.test.js`, `docs/web-migration/*`.

**Зависимости:** нет.

**Миграции:** нет.

**Тесты:** client build/lint; server syntax; matching characterization; secret rescan.

**Критерии готовности:** tracked runtime env удалены; exposed keys rotated externally; build/lint/tests green; current state/formula documented.

**Статус:** реализован локально; внешняя rotation MAX/Yandex keys остаётся обязательной операцией владельца.

## Этап 1. Извлечь listing domain/application services

**Цель:** один набор create/update/close/preview rules вызывается из REST и legacy MAX adapter.

**Файлы:** создать `server/src/domain/listings/*`, `server/src/application/listings/*`, `server/src/repositories/listingsRepository.js`; адаптировать `server/src/listings.js` и функции `persistListing`, `updateListing*`, `replaceListingPhotos` в `server/src/fsm.js`.

**Зависимости:** этап 0, выбранная validation library или небольшие explicit validators.

**Миграции:** пока нет; существующая MySQL schema.

**Тесты:** create LOST/FOUND, allowed fields, status transition, ownership, transaction rollback, category/date/geo validation.

**Критерии готовности:** FSM не содержит прямых INSERT/UPDATE для listings/photos; API не принимает authority из `authorId`; legacy adapter вызывает те же use-cases.

## Этап 2. Versioned migrations and additive user schema

**Цель:** перейти от `migrate.js` к воспроизводимой schema history и подготовить internal identity.

**Файлы:** migration tool/config, `server/migrations/*`, migration runner scripts, `server/src/migrate.js` compatibility note/removal plan.

**Зависимости:** backup текущей MySQL, inventory real data.

**Миграции:** baseline current 12 tables; add nullable `email`, `password_hash`, `display_name`, `telegram`, `status`, `role`, timestamps; make `max_id` nullable; add `refresh_sessions`, verification/reset token tables; add indexes/FKs после orphan audit.

**Тесты:** migrate empty DB, migrate seeded current DB, rollback/forward policy, duplicate email, FK/orphan checks.

**Критерии готовности:** schema создаётся только migrations; current MAX users remain valid; new users do not require MAX id.

## Этап 3. Email/password auth

**Цель:** register/verify/login/refresh/logout/reset/delete foundation.

**Файлы:** `server/src/domain/auth/*`, `server/src/application/auth/*`, `server/src/http/authRouter.js`, auth middleware, web `/login` and `/register`, canonical OpenAPI.

**Зависимости:** этап 2; password hashing, JWT/signing, email adapter; CSRF decision for refresh cookie.

**Миграции:** refresh sessions, verification/reset tokens from stage 2; optional session metadata indexes.

**Тесты:** hashing, generic login/reset errors, access expiry, rotating refresh/reuse detection, cookie flags, logout/revoke-all, rate limits, 401/403.

**Критерии готовности:** protected API derives user from access token; raw refresh/reset tokens are never stored; auth works without MAX token.

## Этап 4. Standalone shell and web ads CRUD

**Цель:** самостоятельные routes и полный browser ads lifecycle.

**Файлы:** remove `@maxhub/max-ui` from `client/package.json`; replace provider/components/styles; expand `client/src/main.jsx` routes; add `/ads`, `/ads/:id`, `/create/lost`, `/create/found`, profile ads; API client; `/api/v1/ads` router/OpenAPI.

**Зависимости:** этапы 1 and 3.

**Миграции:** additive listing title/contact/address/attributes columns where needed; ownership backfill already resolved.

**Тесты:** direct route refresh, create preview/publish, edit/close own ad, 403 foreign ad, public list/detail no contacts, mobile/desktop viewports.

**Критерии готовности:** ads flow no longer requires bot; same services keep legacy MAX flow working during transition.

## Этап 5. Secure uploads and Object Storage

**Цель:** заменить MAX attachments/arbitrary URLs.

**Файлы:** upload domain/service/router, S3 adapter, image inspection, cleanup worker; client uploader; adapt/remove `extractPhotoAttachments` only after parity; OpenAPI.

**Зависимости:** auth, ads service, S3-compatible dev/prod storage.

**Миграции:** add `uploads` metadata/owner/status/expiry/object key; evolve `photos` into `advertisement_photos`; map legacy URLs/tokens as LEGACY rows.

**Тесты:** size/count/MIME/magic bytes, executable rejection, foreign upload 403, expired cleanup, attach transaction, delete retry/idempotency.

**Критерии готовности:** new photos never use MAX tokens or backend disk as source of truth; existing legacy photos remain readable during migration.

## Этап 6. Map, manual picker and geo API

**Цель:** сохранить карту и добавить standalone location creation/search.

**Файлы:** `client/src/pages/Map.jsx`, new map picker/geolocation adapter, ads query DTO/repository, `client/index.html`/env loader, OpenAPI bbox/radius.

**Зависимости:** этап 4, domain-restricted Yandex key, coordinate privacy policy.

**Миграции:** normalized address fields; PostgreSQL/PostGIS only in separate DB migration stage, not required for initial MySQL web cutover.

**Тесты:** geolocation denied, manual selection, bbox/radius edge cases, viewport query, map/list consistency, redacted sensitive coordinates, responsive layout.

**Критерии готовности:** no MAX location attachment needed; backend does bounded query; map does not fetch all active ads.

## Этап 7. Matching baseline v1 and feedback

**Цель:** сохранить known baseline, устранить documented defects и сделать algorithm replaceable.

**Файлы:** `server/src/matching.js`, new `domain/matching` strategies/breakdown, `server/src/cron.js` or worker, matches router/UI/OpenAPI, tests.

**Зависимости:** characterization tests, ads/geo query contract.

**Миграции:** add `algorithm_version`, `score_breakdown`, `updated_at`; add `match_feedback`; pair/version indexes.

**Тесты:** old golden cases, missing date/geo, unique tokens, hard candidate filters, deterministic ranking, idempotent upsert, DB failure visibility, feedback permissions.

**Критерии готовности:** each match stores score/version/breakdown/time; no empty catch; three feedback values persist separately.

## Этап 8. Owner-check claims and protected contacts

**Цель:** перенести проверку владельца на web без собственного chat.

**Файлы:** extract state machine from `server/src/fsm.js`; owner-check domain/application/router; contact policy/endpoint; claim pages; OpenAPI; legacy MAX adapter calls use-cases.

**Зависимости:** auth, ads, notification event interface.

**Миграции:** add claims/owner_questions/owner_answers/ad_contacts; migrate eligible `chats`/members/FSM payload only after mapping report; preserve legacy tables until parity.

**Тесты:** allowed/forbidden transitions, participants, no self-claim, concurrency/double decision, contacts hidden pre-approval/rejection, only selected snapshot exposed.

**Критерии готовности:** direct API cannot reveal contacts before APPROVED; bot and web use same state machine; chat messages are not required for beta.

## Этап 9. Notifications and email outbox

**Цель:** заменить MAX delivery внутренними и transactional email notifications.

**Файлы:** decouple `server/src/notifications.js` from chat; event handlers, outbox repository/worker/email adapter/templates; notifications page/API.

**Зависимости:** auth, matching, owner-check, email provider.

**Миграции:** evolve notifications; add outbox events, attempts/next attempt/processed fields and indexes.

**Тесты:** business transaction + outbox atomicity, retry/backoff/idempotency, provider failure, payload redaction, unread/read ownership.

**Критерии готовности:** email failure never fails user request; mandatory events persist and retry; MAX send is only a removable legacy subscriber.

## Этап 10. Profile, reports and admin

**Цель:** user self-service and minimum moderation/RBAC.

**Файлы:** users/profile/settings routes/UI; reports/admin domain/routes/UI; audit service; OpenAPI.

**Зависимости:** auth and ads lifecycle; deletion/retention policy.

**Миграции:** ad contact snapshots if not added; reports/audit log; moderation status/reason fields; deletion markers.

**Тесты:** own profile boundaries, logout/delete effects, USER blocked from admin, report transitions, hide/restore/block, audit row atomicity.

**Критерии готовности:** reports can be processed by ADMIN; sensitive actions are role-checked and audited; account deletion is explicit and consistent.

## Этап 11. Remove MAX and isolate volunteer scope

**Цель:** product start/build has no MAX dependency.

**Файлы:** remove `server/src/max.js`, `webhook.js`, `polling.js`, `client/src/utils/maxBridge.js`, MAX script/provider/packages, bot-only FSM after parity; remove VK Dobro/volunteer navigation from production scope; archive `swagger.json` outside product OpenAPI.

**Зависимости:** web parity for ads, owner-check, contacts and notifications; migration report for bot states.

**Миграции:** stop writing `states`, `max_id`, chat/volunteer tables; remove columns/tables only after retention/export decision and one release of read-only compatibility.

**Тесты:** dependency/import scan, start without MAX env/network, critical E2E, data migration reconciliation.

**Критерии готовности:** no MAX runtime packages/scripts/env/routes; disabling MAX cannot affect core product; volunteer code cannot enter production UI/API.

## Этап 12. PostgreSQL/PostGIS decision and migration

**Цель:** reach managed PostgreSQL target without blocking earlier web delivery.

**Файлы:** DB adapter/repositories, migrations, data-copy/reconciliation tooling, deploy/runbooks.

**Зависимости:** stabilized domain repositories and measured geo/query needs.

**Миграции:** MySQL→PostgreSQL mapping, enum/time/json semantics, IDs/FKs/indexes; PostGIS geography/GiST only if radius/bbox load justifies it.

**Тесты:** row/count/checksum reconciliation, dual-read shadow checks if used, query plans, rollback/cutover rehearsal, restore test.

**Критерии готовности:** no data loss; production rollback/forward documented; geo/search performance measured.

## Этап 13. Production hardening and deployment

**Цель:** beta-ready HTTPS deployment.

**Файлы:** env schema, validation/error/rate-limit/logging/security middleware, liveness/readiness, production Dockerfiles, CI/CD, infrastructure/runbooks, monitoring/backups.

**Зависимости:** all critical flows, provider accounts/domain/secrets manager.

**Миграции:** final indexes based on query plans; controlled deploy step.

**Тесты:** unit/integration/API/E2E/security/responsive/load smoke, secrets scan, staging deploy, backup restore, health/alerts and rollback rehearsal.

**Критерии готовности:** migration-plan beta DoD is backed by passing evidence; OpenAPI matches deployed API; backup restoration and alerts are verified.

## Ближайший следующий increment

Этап 1 начат: create listing/photos/secrets уже переведён на общий транзакционный `server/src/listingService.js` и покрыт tests. Следующий increment — перенести туда update/close/photo replacement и ввести auth-derived ownership boundary. MySQL, React feed/map и MAX adapter пока сохраняются.

## Реализовано к 12 августа 2026

- Этап 0 завершён: секреты удалены из текущего worktree, Yandex key вынесен в env, client lint/build зелёные, matching baseline зафиксирован тестами.
- Этап 1 завершён для listing create/update/status/photos: REST и legacy MAX adapter используют общий service; ownership берётся из аутентифицированного пользователя.
- Этап 2 реализован: `schema_migrations`, baseline `001`, additive web-auth schema `002`, идемпотентный runner и unit tests. MySQL DDL auto-commit учитывается: migrations пишутся идемпотентно и восстанавливаются forward-only повторным запуском.
- Этап 3 реализован частично: register/login/logout, 15-минутный JWT, HttpOnly rotating refresh, reuse-family revocation, `scrypt`, profile/update/delete, rate limits. Email verification/reset требуют подключения email provider/outbox.
- Этап 4 начат: standalone React shell больше не импортирует MAX UI/Bridge; добавлены `/login`, `/register`, `/ads`, `/ads/:id`, `/create/lost`, `/create/found`, canonical `/api/v1/ads` и `openapi.yaml`. Редактирование собственных объявлений и защищённые uploads ещё впереди.

Следующий безопасный increment: Object Storage upload metadata/API, затем owner-check/contact state machine. До появления upload endpoint web API намеренно отклоняет произвольные photo URLs и secrets.

## Реализовано во втором implementation slice

- Завершён browser ads lifecycle: профиль, приватные контакты, список собственных ACTIVE/CLOSED объявлений, редактирование и закрытие с ownership-bound SQL.
- Добавлены `/profile` и `/ads/:id/edit`; удаление аккаунта анонимизирует пользователя, отзывает refresh sessions и закрывает активные объявления.
- Добавлена migration `003_uploads`, S3-compatible adapter, `POST /api/v1/uploads` и `PUT /api/v1/ads/:id/images`.
- Upload принимает один JPEG/PNG/WebP до 8 МБ, проверяет magic bytes и совпадение MIME, хранит SHA-256/metadata, ограничивает три фото и привязывает upload только владельцем к собственному объявлению.
- Просроченные PENDING uploads очищаются фоновым job; заменённые объекты удаляются после DB commit с явным логированием сбоя cleanup.
- OpenAPI расширен до 13 paths. Production dependency audit после compatible updates сообщает 0 vulnerabilities.

Следующий этап: email verification/password reset через outbox/provider, после него перенос owner-check и раскрытия контактов. Для реальной проверки uploads потребуются S3-compatible test bucket credentials; они не должны попадать в Git.

## Реализовано в третьем implementation slice

- Добавлены email verification, повторная отправка, generic forgot-password и single-use password reset.
- Action tokens purpose-bound, подписаны отдельным `EMAIL_TOKEN_SECRET`; в token tables и outbox хранятся только hash/tokenId, рабочая ссылка восстанавливается перед отправкой.
- Outbox worker использует lease, `FOR UPDATE SKIP LOCKED`, retry с exponential backoff и не теряет событие при ошибке email provider.
- Сброс пароля отзывает refresh sessions и увеличивает `auth_version`, поэтому старые access JWT перестают работать немедленно.
- Новые аккаунты могут войти и открыть профиль, но создание/изменение объявлений и uploads запрещены до подтверждения email. Пользователи до migration `004` grandfathered как verified.
- Production startup требует email provider configuration; development использует metadata-only log adapter без вывода ссылок/токенов.

Следующий этап — отдельная web owner-check модель и deny-by-default endpoint контактов.

## Реализовано в четвёртом implementation slice

- Owner-check полностью перенесён в web: владелец FOUND задаёт 1–3 вопроса, заявитель отправляет полный набор ответов, а автор принимает или отклоняет заявку.
- Вопросы и ответы сохраняются snapshot-ами; двойная заявка и self-claim запрещены. Контакты автора snapshot-ятся и раскрываются только участникам после `APPROVED`, объявление при этом закрывается.
- Добавлена страница внутренних уведомлений с ownership-bound отметкой о прочтении. События owner-check и новое совпадение создают уведомления транзакционно.
- Matching обновлён до `baseline-v1`: категория — жёсткий фильтр, пропущенные дата/гео дают нулевой компонент, повторяющиеся слова не завышают score.
- Migration `006_matching_v1` добавляет `algorithm_version`, JSON `score_breakdown`, `updated_at` и отдельный датасет `match_feedback` с тремя значениями.
- Matching job делает идемпотентный insert/update, не проглатывает DB-ошибки и уведомляет обоих владельцев только при первом создании пары.
- Добавлены защищённые `/api/v1/matches`, feedback API и адаптивная страница `/matches` с разложением оценки и переходом в owner-check.
- OpenAPI исправлен и расширен до 26 paths, включая owner-check, notifications и matches.

Следующий этап — reports/moderation/admin, затем production hardening и staging integration с реальными MySQL, Object Storage и email provider.

## Реализовано в пятом implementation slice

- Migration `007_moderation` добавляет reports, audit log и moderation statuses для объявлений.
- Пользователь может отправить одну жалобу на чужое активное объявление; endpoint rate-limited и не раскрывает административные данные.
- ADMIN API защищён проверкой роли: очередь жалоб, переходы `OPEN → IN_REVIEW → RESOLVED/REJECTED`, список объявлений и пользователей, hide/restore/delete и block/unblock.
- Блокировка отзывает refresh sessions и скрывает активные объявления. Администратор не может заблокировать себя или другого ADMIN.
- Каждое изменение жалобы, объявления или пользователя атомарно записывается в `audit_log`; добавлены `/ads/:id/report` и адаптивная `/admin`.
- Production composition root больше не импортирует MAX/webhook, устаревший `/listings` alias удалён, `@maxhub/max-bot-api` удалён из dependencies. Legacy FSM/volunteer code остаётся только неисполняемым архивом совместимости.
- Добавлены liveness/readiness, multi-stage server/client images, nginx SPA fallback и reverse proxy, отдельный `docker-compose.prod.yml` для внешних managed services.
- README переписан под standalone web. OpenAPI расширен до 35 paths.

Следующий этап требует инфраструктурных credentials: поднять staging с managed MySQL, test Object Storage и transactional email provider, выполнить migrations и critical-flow smoke/E2E, затем настроить backups, monitoring и CI/CD.

## Реализовано в шестом implementation slice

- Добавлены request ID, JSON access/error logs без query/body/secrets, browser security headers, production HSTS и общий rate limit.
- CI устанавливает lockfile dependencies, запускает 66 server tests, runtime audit, client lint/build и OpenAPI lint.
- Runtime dependency audit сообщает 0 vulnerabilities; production MAX import/dependency scan чистый.
- Compose manifests и `git diff --check` проходят. Фактическая Docker build проверка выполнена в следующем implementation slice после запуска Docker Desktop.
- Добавлен `staging-runbook.md` с env contract, deploy sequence, critical smoke, backup/restore gate и alert thresholds.

## Реализовано в седьмом implementation slice

- Добавлен отдельный `docker-compose.rehearsal.yml`: production targets API/nginx, изолированная MySQL и порт `18080` не пересекаются с dev-стеком.
- Production images фактически собраны и запущены; все три контейнера проходят healthchecks, migrations `001`–`011` применяются автоматически.
- Исправлен nginx proxy для `/health/ready`; прямые SPA routes проходят fallback через production nginx.
- Smoke расширен privacy request сценарием: email авторизованного аккаунта нельзя подменить, запрос появляется у ADMIN и закрывается с privacy-safe audit metadata.
- На SPA включены HSTS, deny framing, `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy и CORP; устаревшие MAX/VK frame allowlists удалены также из Vercel config.
- Client/server dependency audits показывают 0 vulnerabilities; CI теперь проверяет client build dependencies отдельно.
- Локальный backup/restore drill делает consistent `mysqldump`, восстанавливает его во временную БД и сравнивает counts migrations/users/listings/privacy requests/audit log.

Оставшийся production gate внешний: реальные staging credentials/resources, managed-provider restore drill, HTTPS domain, доставка email/Object Storage и provider monitoring.
