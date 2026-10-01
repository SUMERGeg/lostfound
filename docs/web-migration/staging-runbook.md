# Staging runbook

## Требуемые внешние ресурсы

- managed MySQL 8 с TLS, отдельными database/user для staging и production;
- S3-compatible private bucket и публичный CDN/base URL только для проверенных изображений;
- transactional email endpoint и проверенный sender;
- HTTPS domain/load balancer перед nginx;
- secret manager для JWT/email/S3/DB credentials;
- централизованные JSON logs и HTTP/worker alerts.

Секреты не сохраняются в repository, Docker image или build logs. Старые MAX/Yandex credentials, присутствовавшие в Git history, должны быть отозваны у провайдеров.

## Обязательные env

Server:

```text
NODE_ENV=production
PORT=8080
FRONT_ORIGIN=https://staging.example.com
JWT_ACCESS_SECRET=<independent 32+ byte secret>
EMAIL_TOKEN_SECRET=<different 32+ byte secret>
PRIVACY_EMAIL=<monitored data-subject request mailbox>
PRIVACY_REQUEST_RATE_LIMIT_MAX=5
DB_HOST=<managed mysql host>
DB_PORT=3306
DB_USER=<least-privilege app user>
DB_PASSWORD=<secret>
DB_NAME=lostfound
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_PUBLIC_BASE_URL=<public image base>
S3_ACCESS_KEY_ID=<secret>
S3_SECRET_ACCESS_KEY=<secret>
EMAIL_API_URL=<provider endpoint>
EMAIL_API_TOKEN=<secret>
EMAIL_FROM=<verified sender>
```

Build:

```text
VITE_YANDEX_MAPS_API_KEY=<domain-restricted browser key>
```

## Локальная production-репетиция

Изолированный rehearsal-стек использует production targets обоих Dockerfile, отдельную MySQL и порт `18080`. Указанные в нём email/S3 endpoints намеренно не существуют: этот прогон проверяет сборку, migrations, nginx routing и сценарии без внешней доставки и загрузки объектов.

```powershell
.\scripts\production-rehearsal.ps1
```

Скрипт собирает образы, ждёт healthchecks, заполняет отдельную базу demo-данными и запускает smoke для readiness, feed, auth, matching, privacy requests и ADMIN RBAC. Затем он делает `mysqldump`, восстанавливает его в отдельную временную БД, сравнивает counts миграций и ключевых таблиц и удаляет только эту временную БД. Стек остаётся поднятым для ручной проверки на `http://127.0.0.1:18080`.

```powershell
docker compose -f docker-compose.rehearsal.yml down
```

Добавление `--volumes` к команде остановки удалит только именованный rehearsal volume и применяется, когда нужна полностью чистая база следующего прогона.

## Deploy sequence

1. Снять provider snapshot/backup БД перед migration.
2. Собрать immutable images: `docker compose -f docker-compose.prod.yml build`.
3. Запустить server. Container выполняет `npm run migrate` перед `npm start`.
4. Проверить `GET /health/live` и `GET /health/ready`.
5. Запустить nginx/client и проверить SPA fallback прямым открытием `/login`, `/profile`, `/matches`.
   Проверить на HTML `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` и HSTS.
6. Записать image digest, migration IDs и время deploy в release log.

## Critical smoke

В staging нужны минимум два обычных пользователя и один `ADMIN`:

1. Register → verification email → verify → login → refresh → logout.
2. Forgot password → reset → убедиться, что старый access/refresh больше не работает.
3. Создать LOST и FOUND с ручной точкой на карте и JPEG/PNG/WebP upload.
4. Запустить/дождаться matching → увидеть уведомление → сохранить все три варианта feedback.
5. Настроить вопросы FOUND → отправить owner-check другим пользователем → approve → получить snapshot контактов; до approve endpoint обязан вернуть 403.
6. Подать жалобу → ADMIN переводит в работу → скрывает объявление → закрывает жалобу → проверить audit row.
7. ADMIN блокирует пользователя → refresh отозван, активные объявления скрыты; разблокировка не должна автоматически публиковать их.
8. Проверить mobile/desktop layout и отсутствие горизонтального scroll на 360, 768 и 1440 px.
9. Отправить privacy request авторизованным пользователем → убедиться, что spoofed email проигнорирован → ADMIN закрывает запрос → audit row не содержит email и текста обращения.

## Backup/restore gate

До production cutover недостаточно наличия backup policy: нужен успешный restore drill в отдельную БД.

- ежедневный full backup плюс provider point-in-time recovery;
- retention не менее 14 дней для beta;
- quarterly restore drill, для первого production deploy — обязательный;
- после restore выполнить `SELECT id FROM schema_migrations ORDER BY applied_at`, counts ключевых таблиц и critical read-only smoke;
- Object Storage versioning/lifecycle настраиваются у провайдера отдельно от DB backup.

## Alerts

Минимальные сигналы:

- `/health/ready` неуспешен 3 проверки подряд;
- HTTP 5xx > 2% за 5 минут;
- p95 latency > 1.5 s за 10 минут;
- outbox event не обработан более 15 минут или attempt count растёт;
- matching scheduled run завершился ошибкой;
- upload cleanup систематически не удаляет истёкшие объекты;
- DB connections/CPU/storage близки к provider limits.

Логи API содержат `requestId`, method, path без query string, status и duration. Токены, email links, Authorization/Cookie и request body не логируются.
