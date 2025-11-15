# Lost&Found MAX

Проект разрабатывается командой для хакатона VK Education в экосистеме MAX. Цель — построить безопасный сервис поиска потерянных и найденных вещей с единой базой объявлений, автоматическим матчингом, картой и мини-приложением, которое удобно открывать прямо из бота.

MiniApp + Node.js API для хакатона MAX: помогает соединять людей, потерявших вещи, с теми, кто их нашёл. В репозитории сразу лежит фронтенд (React/Vite), бэкенд (Express + MySQL), скрипты миграций/сидов, конфиги Docker и long polling бот для MAX.

---

## ⚙️ Стек

| Слой         | Технологии |
|--------------|------------|
| MiniApp      | React 18 / Vite, MAX UI (`@maxhub/max-ui`), React Router, Yandex Maps JS API 2.1, fetch |
| Backend      | Node.js 20, Express 5, mysql2/promise, dotenv, node-cron, `@maxhub/max-bot-api` (long polling) |
| БД/Инфра     | MySQL 8 (Docker, порт 3307), Docker/Docker Compose, ngrok (для вебхуков) |

📄 Полный список зависимостей и версий: `requirements.txt`.

---

## 📁 Структура репозитория

```
lostfound/
├── client/                 # React/Vite MiniApp
│   ├── src/
│   │   ├── pages/          # Home (лента), Map, Listing
│   │   ├── components/     # Filters и др.
│   │   ├── styles/         # global.css (MAX UI + кастом)
│   │   └── utils/          # categories, maxBridge заглушка
│   ├── public/
│   │   └── sample/         # mock-фото для ленты
│   └── Dockerfile
│
├── server/                 # Express API + MAX Bot
│   ├── src/
│   │   ├── index.js        # точка входа, /health, /listings, /webhook
│   │   ├── listings.js     # CRUD и фильтры
│   │   ├── matching.js     # скоринг найдено/потеряно
│   │   ├── cron.js         # пересчёт совпадений раз в 10 мин
│   │   ├── db.js           # mysql2 pool
│   │   ├── migrate.js      # создание таблиц
│   │   ├── seed.js         # 4 тестовых объявлений (Москва)
│   │   ├── max.js          # заглушки обработки событий MAX
│   │   ├── polling.js      # long polling `/updates`
│   │   └── notifications.js# отправка системных пушей (заготовка)
│   ├── .env.example / Dockerfile
│
├── docker-compose.yml      # mysql + server + client
├── requirements.txt        # список библиотек и версий
└── README.md
```

---

## 🧰 Предварительные условия

1. **Node.js 20** (https://nodejs.org/en/download)
2. **npm 10** (идёт в комплекте)
3. **Docker Desktop** + `docker compose`
4. **Яндекс-карты API key** (https://developer.tech.yandex.ru/services/)
5. **MAX Bot token** (из консоли MAX)

---

## 🔑 Переменные окружения

`server/.env` (см. `.env.example`):
```
PORT=8080
NODE_ENV=development

FRONT_ORIGIN=http://localhost:5173
MAX_BOT_TOKEN=f9LHodD0cOJbLteSGAgksy33Rje4M6dwlQVI5qXVCz_qU5XEgVXu8FiVRjEGzMq4NiVa-0wgbnE8g_-r-Hx5
MAX_API_BASE=https://platform-api.max.ru
# MySQL (если используете Docker)
DB_HOST=mysql
DB_PORT=3306
DB_USER=dev
DB_PASSWORD=dev
DB_NAME=lostfound

SECRETS_KEY=any-random-32-byte-hex-string
```

`client/.env` (см. `.env.example`):
```
VITE_API_BASE=http://localhost:8080
```

---

## 🚀 Запуск локально (без Docker)

### 1. Поднять MySQL

```powershell
docker compose up -d mysql
# DB доступна на 127.0.0.1:3307 (user dev/dev)
```

### 2. Настроить сервер

```powershell
cd server
cp .env.example .env    # заполнить токены и доступ к БД
меняем переменные БД на HOST=127.0.0.1; PORT=3307
npm install
npm run migrate         # создаёт таблицы
npm run seed            # наполняет 4 демо-объявления
npm run dev             # старт Express API + cron + polling
```

API появится на `http://localhost:8080`. Проверка:

```powershell
curl http://localhost:8080/health     # {"ok":true}
curl "http://localhost:8080/listings?limit=2"
```

### 3. Настроить клиент

```powershell
cd client
npm install
npm run dev    # Vite поднимет MiniApp на http://localhost:5173
```

MiniApp сразу подтягивает данные из API и карту Яндекс.

---

## 🐳 Запуск через Docker

> Убедитесь, что `server/.env` содержит настройки для подключения к контейнеру MySQL: `DB_HOST=mysql`, `DB_PORT=3306`.

```powershell
cd "ВАШ ПУТЬ К ПРОЕКТУ"   # корень репозитория
docker compose build                      # собираем client/server
docker compose up -d                      # поднимаем mysql, server, client

# Прогоняем миграцию и сид внутри контейнера server
docker compose exec server npm run migrate
docker compose exec server npm run seed
```

Порты:

| Сервис | Порт хоста | Описание |
|--------|------------|----------|
| MySQL  | 3307       | dev/dev |
| API    | 8080       | Express |
| MiniApp| 5173       | Vite dev server |

Проверка:

```powershell
curl http://localhost:8080/health
curl http://localhost:5173/
```

Остановка/перезапуск:

```powershell
docker compose down        # остановить и удалить контейнеры
docker compose logs -f     # посмотреть логи
docker compose restart     # перезапустить все контейнеры
```

---

## 🤖 MAX Bot

Для локальных тестов используется **long polling** (`server/src/polling.js`). Он стартует автоматически вместе с `npm run dev`. Бот обрабатывает команды:
   - `/start` — приветствие + кнопка «Открыть карту»
   - `/stats` — количество активных объявлений в БД


---

## 🧩 Основные консольные команды

| Команда | Описание |
|---------|----------|
| `npm run migrate` (server) | создаёт все таблицы |
| `npm run seed` (server)    | наполняет тестовыми данными |
| `npm run dev` (server)     | Express + cron + polling |
| `npm run dev` (client)     | Vite dev server |
| `docker compose build`     | сборка образов |
| `docker compose up -d`     | запуск mysql/server/client |
| `docker compose down`      | остановка |
| `docker compose logs -f server` | просмотр логов API |

---

## 🔍 Быстрая проверка из командной строки

```powershell
cd lostfound
docker compose build
docker compose up -d
docker compose exec server npm run migrate
docker compose exec server npm run seed
curl http://localhost:8080/health
curl "http://localhost:8080/listings?limit=1"
start http://localhost:5173/
```

---