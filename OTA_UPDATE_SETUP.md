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

## Как выпустить обновление

1. Поднять версию в:
   - `package.json`
   - `package-lock.json`
   - `src-tauri/tauri.conf.json`
2. Закоммитить изменения
3. Создать тег вида:
   - `v1.0.3`
4. Запушить тег:

```bash
git tag v1.0.3
git push origin v1.0.3
```

После этого workflow `Release Tauri App` соберёт релиз и updater-артефакты.
