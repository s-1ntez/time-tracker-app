# OTA Update Setup

Для автообновлений Tauri через GitHub Releases нужны 2 секрета в репозитории:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Локально ключи созданы в:

- `.updater/updater-private.key`
- `.updater/updater-password.txt`

Эти файлы не коммитятся.

## GitHub

Добавьте в `Settings -> Secrets and variables -> Actions -> Secrets`:

- `TAURI_SIGNING_PRIVATE_KEY`: содержимое `.updater/updater-private.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: содержимое `.updater/updater-password.txt`

Примечание:

- `.updater/updater-private.key` в этом проекте хранится в base64-виде
- release workflow теперь умеет принимать и raw minisign key, и base64-строку

## Как выпустить обновление

1. Поднять версию в:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/tauri.conf.json`
2. Закоммитить изменения
3. Создать тег вида:
   - `v1.0.6`
4. Запушить тег:

```bash
git tag v1.0.6
git push origin v1.0.6
```

После этого workflow `Release Tauri App` соберёт релиз и updater-артефакты.

## Что должно получиться

После успешного tag release в GitHub Releases должны появиться:

- desktop assets для macOS и Windows
- updater artifacts
- `latest.json`

Кнопка обновления в desktop-приложении работает только после появления:

- `https://github.com/s-1ntez/time-tracker-app/releases/latest/download/latest.json`

Для macOS release workflow собирает:

- `x86_64-apple-darwin`

Это нужно, чтобы обновления были совместимы с вашим x64 macOS installer и macOS 12+.
