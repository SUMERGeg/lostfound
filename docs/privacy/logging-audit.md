# Аудит логирования

Дата: 13 августа 2026 г.

## Что пишет активный production-контур

| Компонент | Текущие данные | Оценка |
|---|---|---|
| Express request log | request ID, method, path без query, status, duration | разумный privacy-safe минимум |
| Express error log | те же метаданные + error name/message | bodies/headers не пишутся, но нет общей redaction-функции |
| Email dev adapter | plaintext email получателя и template | допустимо только локально; не использовать с реальными адресами |
| Email outbox | payload с email/displayName/token ID; `last_error` | требует retention и контроля ошибок провайдера |
| Nginx | стандартный access log; конфигурация не редактирует URI | action token в query может попасть в log |
| MySQL audit log | административные мутации | auth/security events отсутствуют |

Не найдено активного логирования Authorization, cookie, raw JWT/refresh/action tokens, request body, IP, User-Agent или query string на уровне Express.

## Риски

1. `/reset-password?token=...` и `/verify-email?token=...` приходят сначала на nginx; стандартный access log обычно видит полный URI.
2. `error.message` потенциально может включить данные стороннего SDK/DB. Встроенный email provider формирует status-only ошибку, но общего инварианта нет.
3. Нет сроков хранения/ротации/доступа к nginx и application logs.
4. Не фиксируются login outcome, refresh reuse, family revoke/logout, password reset, verification, account deletion и admin authentication.
5. Dormant legacy MAX-модули содержат более подробный контекст и префикс секрета; хотя production isolation их не монтирует, они создают риск регрессии.

## Требования к Stage 1–2

- Перенести action credential в URL fragment либо одноразово обменивать query token и немедленно redirect на чистый URL.
- Настроить nginx/CDN log filtering для action routes и добавить `Referrer-Policy: no-referrer`/security headers на SPA document.
- Ввести централизованный logger allowlist + redaction keys (`token`, `authorization`, `cookie`, `password`, `email`, `phone`, `telegram`, `answer`, `body`).
- Запретить dev email adapter в production проверкой конфигурации.
- Ввести security events: тип, время, actor/user pseudonymous ID, outcome, request ID; IP — только если владелец утвердит цель, срок и форму минимизации.
- Утвердить retention отдельно для access, error, security, email и admin audit logs; ограничить роли чтения и экспорт.
- CI-тестом отправлять canary secret/email и проверять, что они не появились в перехваченных логах.
