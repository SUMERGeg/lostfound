# Lost&Found

Standalone web-сервис для поиска потерянных и найденных вещей. React-клиент и собственный Express REST API работают напрямую по web URL, без MAX Mini App, Bot API и SDK мессенджера в production runtime.

## Возможности

- регистрация, вход, rotating HttpOnly refresh sessions, подтверждение email и восстановление пароля;
- LOST/FOUND объявления, карта, фильтры, ручной выбор координат и безопасная загрузка до трёх фотографий;
- версионированный matching с разложением score и пользовательским feedback;
- owner-check с закрытыми ответами и раскрытием контактов только после подтверждения;
- внутренние уведомления и transactional email outbox;
- жалобы, ADMIN RBAC, скрытие/удаление объявлений, блокировка пользователей и audit log;
- OpenAPI, forward-only migrations, health/readiness endpoints и production Docker images.

Legacy MAX/FSM/volunteer файлы пока сохранены для анализа исторических данных, но не импортируются composition root, не доступны через HTTP и не входят в production dependencies.

## Стек

| Слой | Технологии |
|---|---|
| Frontend | React 18, Vite, React Router, Yandex Maps JS API 2.1 |
| Backend | Node.js 20, Express 5, MySQL 8, mysql2, node-cron |
| Storage/email | S3-compatible Object Storage, HTTP transactional email provider |
| Deployment | Multi-stage Docker, nginx SPA/reverse proxy |

## Локальный запуск

### Витрина без backend — Vercel

Для демонстрации интерфейса без регистрации и публикации используйте `cd client`, затем `npm run dev:demo`. Сборка: `npm run build:demo`. Vercel уже настроен на эту read-only сборку; при импорте репозитория выберите **Root Directory: client**, переменные окружения не нужны.

Пошаговая инструкция: [Vercel demo](docs/web-migration/vercel-demo.md). Обычные команды `dev` и `build` сохраняют полноценный режим сервиса.

### Полноценный сервис

1. Создайте локальные env-файлы, которые игнорируются Git:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

2. Укажите как минимум независимые `JWT_ACCESS_SECRET` и `EMAIL_TOKEN_SECRET` длиной от 32 байт. Для загрузок нужны параметры test bucket; реальные credentials не коммитятся.

3. Запустите dev-окружение:

```powershell
docker compose up -d mysql
cd server
npm ci
npm run migrate
npm run seed
npm run dev
```

В другом терминале:

```powershell
cd client
npm ci
npm run dev
```

Клиент: `http://localhost:5173`; API: `http://localhost:8080`; readiness: `http://localhost:8080/health/ready`.

## Проверка

```powershell
cd server
npm test

cd ../client
npm run lint
npm run build
```

Актуальный контракт API находится в [`openapi.yaml`](openapi.yaml), архитектурный аудит и последовательность миграции — в [`docs/web-migration`](docs/web-migration).

## Demo and local smoke

After `npm run seed`, three verified demo accounts are available. They all use the password `DemoPassword!2026`:

- `anton@example.test` — LOST listing owner and matching recipient;
- `irina@example.test` — FOUND listing holder and owner-check reviewer;
- `admin@example.test` — administrator with moderation access.

The seed command also creates the demo matching pair. With the API running, verify readiness, the public feed, authentication, matching and administrator RBAC:

```powershell
cd server
npm run smoke:local
```

## Production image

`docker-compose.prod.yml` собирает production targets: Node API запускает migrations перед стартом, а nginx раздаёт собранную SPA и проксирует `/api` на backend.

```powershell
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Перед staging можно прогнать полностью изолированную локальную production-репетицию с production Docker targets, отдельной MySQL, API/privacy smoke и backup/restore drill:

```powershell
.\scripts\production-rehearsal.ps1
```

Результат доступен на `http://127.0.0.1:18080`. Подробности и команда остановки описаны в [`docs/web-migration/staging-runbook.md`](docs/web-migration/staging-runbook.md).

Production использует внешнюю managed MySQL и S3-compatible Object Storage из `server/.env`. HTTPS/TLS должен завершаться на cloud load balancer или ingress перед портом nginx `8080`.

Обязательные production env дополнительно включают `NODE_ENV=production`, `FRONT_ORIGIN`, email provider (`EMAIL_API_URL`, `EMAIL_API_TOKEN`, `EMAIL_FROM`) и Object Storage credentials. Старые ключи, когда-либо попавшие в Git history, необходимо отозвать у провайдеров.
