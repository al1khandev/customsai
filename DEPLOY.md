# Лучший вариант развёртывания

Для этого проекта лучший вариант: VPS с Docker и постоянным диском.

Почему именно так:
- `whatsapp-web.js` требует постоянную браузерную сессию и файловое хранилище.
- VPS не засыпает, не зависит от вашего ноутбука и переживает перезагрузки.
- Docker volume сохраняет QR-сессию WhatsApp, настройки и историю деклараций.

## Что уже подготовлено в проекте

- `docker-compose.yml` для постоянного запуска
- `/health` endpoint для проверки контейнера
- хранение сессии и файлов в `/data`
- строгая верификация ТН ВЭД только через `keden.kz`

## Как запускать на VPS

1. Возьмите VPS с Ubuntu 22.04+ и 2 GB RAM или больше.
2. Установите Docker и Docker Compose.
3. Скопируйте проект на сервер.
4. Создайте `.env` на основе `.env.example`.
5. Укажите `PUBLIC_PANEL_URL` с вашим доменом.
6. Запустите:

```bash
docker compose up -d --build
```

7. Откройте панель по вашему домену и один раз отсканируйте QR.

После этого бот будет работать 24/7, даже когда ваш компьютер выключен.

## Как сделать полностью автономно (без вашего участия)

1. Включите автозапуск Docker после перезагрузки VPS:

```bash
sudo systemctl enable docker
```

2. Запускайте сервис только через Compose (уже настроен `restart: unless-stopped`):

```bash
docker compose up -d
```

3. В проекте уже включён self-healing:
   - автопереподключение WhatsApp после обрыва;
   - watchdog, который перезапускает процесс при долгом disconnect;
   - Docker healthcheck + рестарт контейнера.

4. Делайте ежедневный бэкап persistent-данных (`/data` volume), чтобы не потерять сессию и PDF:

```bash
mkdir -p /opt/customsai-backups
docker run --rm \
  -v customsai_customsai_data:/from \
  -v /opt/customsai-backups:/to \
  alpine sh -c "tar czf /to/customsai-$(date +%F).tar.gz -C /from ."
```

5. Добавьте cron на ежедневный бэкап (пример на 03:30):

```bash
crontab -e
```

```cron
30 3 * * * docker run --rm -v customsai_customsai_data:/from -v /opt/customsai-backups:/to alpine sh -c "tar czf /to/customsai-$(date +\%F).tar.gz -C /from ."
```

6. (Опционально) Подключите мониторинг (Uptime Kuma / Better Stack) на `/health`, чтобы получать алерты при падениях.

## Важное про ТН ВЭД

- Код больше не берётся из локальной базы и не генерируется ИИ.
- Источник только `keden.kz`.
- Если `keden.kz` возвращает несколько вариантов, сервис не угадывает код и останавливает генерацию, пока не будет выбран официальный вариант.
