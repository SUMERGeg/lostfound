# Демонстрационная витрина на GitHub Pages

Адрес: https://SUMERGeg.github.io/lostfound/.

Публикуется только статический клиент с вымышленными объявлениями. Регистрация, публикация и отправка форм отключены; API, база и ключ карты не нужны. Vercel и полноценная сборка сохраняются.

## Настройка и обновление

1. В репозитории **Settings → Pages → Build and deployment → Source** выберите **GitHub Actions**.
2. Отправьте изменения в `main`. Workflow **Deploy demo to GitHub Pages** автоматически выполнит тесты, `npm run build:pages` и публикацию.
3. Дождитесь зелёного результата в **Actions**. При необходимости запуск повторяется кнопкой **Run workflow**.

Маршруты используют `#`: `/lostfound/#/ads`, `/lostfound/#/map`, `/lostfound/#/ads/demo-phone`. Такие ссылки можно отправлять другим людям и обновлять без ошибки 404. Фотографии и JS загружаются из `/lostfound/`.

## Локальная проверка

Из `client`:

```powershell
npm ci
npm test
npm run build:pages
npm run preview
```

Откройте `http://localhost:4173/lostfound/#/ads`. Проверьте ленту, фильтры, схему и обновление карточки; `#/register` должен перенаправлять на ленту.

Для Vercel остаётся `npm run build:demo`, для полноценного сервиса — `npm run build`.
