# Развертывание на Railway.io

Railway.io - это облачная платформа, похожая на Heroku, но лучше и дешевле. Поддерживает Docker.

## 📋 Требования
- GitHub аккаунт (или Google/GitLab)
- Проект загружен на GitHub

## 🚀 Пошаговые инструкции

### Шаг 1: Подготовить проект локально

```bash
cd "/Users/alikhan/Desktop/AI Projects/Customs Declaration"
```

**Создать файл `.env`:**
```bash
cp .env.example .env
```

**Открыть `.env` в редакторе и заполнить:**
```
PORT=3000
PUBLIC_PANEL_URL=https://customsai.railway.app
NVIDIA_API_KEY=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
WHATSAPP_CLIENT_ID=customsai
DATA_DIR=/data
AUTH_DIR=/data/whatsapp-auth
DECLARATIONS_DIR=/data/declarations
SETTINGS_FILE=/data/settings.json
KEDEN_TNVED_URL=https://keden.kz/tnved
```

**Важно**: 
- `PUBLIC_PANEL_URL` замените на ваш реальный URL (узнаете после создания проекта)
- `NVIDIA_API_KEY` - ваш ключ для ИИ анализа

### Шаг 2: Залить проект на GitHub

Если еще не на GitHub:

```bash
# Инициализировать репо
git init
git add .
git commit -m "Initial commit"

# Создать репозиторий на github.com
# Потом:
git remote add origin https://github.com/ВАШ_ЮЗЕР/customs-declaration.git
git push -u origin main
```

### Шаг 3: Создать проект на Railway.io

1. Откройте https://railway.app
2. Нажмите **"Sign in"** → выберите GitHub
3. Авторизуйтесь и разрешите доступ
4. Нажмите **"Create New Project"**
5. Выберите **"Deploy from GitHub repo"**
6. Выберите ваш репозиторий `customs-declaration`
7. Railway автоматически найдет `Dockerfile` и `railway.json`

### Шаг 4: Настроить переменные окружения

На странице проекта в Railway:

1. Откройте вкладку **"Variables"**
2. Добавьте переменные из `.env`:
   - `PORT` = `3000`
   - `PUBLIC_PANEL_URL` = (узнаете после деплоя, сейчас пропустите)
   - `NVIDIA_API_KEY` = ваш ключ
   - Остальные из `.env`

3. Нажмите **"Deploy"**

### Шаг 5: Ждите деплоя (3-5 минут)

Вы увидите логи. Ждите сообщения:
```
✅ Railway deployment successful
🌐 Your app is live at: https://customsai-xxx.railway.app
```

### Шаг 6: Обновить PUBLIC_PANEL_URL

1. Скопируйте ваш URL (например: `https://customsai-prod-xyz.railway.app`)
2. Вернитесь в **Variables**
3. Измените `PUBLIC_PANEL_URL` на ваш реальный URL
4. Сохраните

Railway автоматически перезагрузит приложение.

### Шаг 7: Проверить, что работает

Откройте ваш URL в браузере:
```
https://customsai-prod-xyz.railway.app
```

Вы должны увидеть панель управления CustomsAI.

---

## ✅ Готово!

Теперь ваш бот работает 24/7 на публичном URL.

---

## 📱 Использование

1. Откройте панель: `https://customsai-prod-xyz.railway.app`
2. Перейдите на вкладку **"Подключение"**
3. Отсканируйте QR-код своим WhatsApp
4. Начните использовать бота!

---

## 💾 Данные и логи

Railway хранит:
- Логи деплоя и ошибки (вкладка **"Logs"**)
- Данные WhatsApp сессии в `/data` томе
- Сгенерированные PDF в `/data/declarations`

Эти данные **сохраняются** между перезагрузками (из-за volume).

---

## 💰 Стоимость

**Бесплатно первые 500 часов**, потом:
- ~$5/месяц за минимальный контейнер (5 CPU credits/месяц)
- Платите только за использованное время
- Можно установить лимит расходов

---

## 🆘 Если что-то не работает

### "Can't find Dockerfile"
- Убедитесь, что `Dockerfile` в корне проекта
- Нажмите **Redeploy** на странице проекта

### "WhatsApp не подключается"
- Проверьте логи (вкладка Logs)
- Откройте панель на https://ВАШ_URL/health
- Должен вернуться JSON с `"ok": true`

### "Ошибка WeasyPrint"
- Это значит, что Python не установился в контейнер
- Проверьте Dockerfile строку 29
- Пересоздайте деплой: нажмите **Redeploy**

### "Порт занят"
- Railway автоматически маршрутизирует на порт 3000
- Не нужно ничего менять

---

## 📚 Полезные команды Railway CLI

```bash
# Показать статус деплоя
railway status

# Показать логи в реальном времени
railway logs

# Посмотреть переменные
railway variable

# Подключиться к контейнеру (редко нужно)
railway shell
```

---

## 🔑 Важно про API ключи

В `.env` и в Railway variables хранятся чувствительные данные:
- `NVIDIA_API_KEY` - ваш приватный ключ
- Не коммитьте `.env` в Git (уже в `.gitignore`)
- Railway шифрует переменные

---

## ✨ После успешного деплоя

**Поделитесь ссылкой:**
```
https://customsai-prod-xyz.railway.app
```

Люди могут открыть панель и начать использовать бота!

---

## 📞 Служба поддержки

Railway: https://docs.railway.app
Их чат поддержки всегда помогает за 15 минут.
