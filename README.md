# Call Tips — Windows / Cross-Platform

AI-коучинг в реальном времени во время интервью. Electron-версия оригинального [call-tips](../call-tips/) для Mac.

**Работает на:** Windows 10/11, macOS, Linux

## Что умеет

- 🎙 Захват микрофона → транскрипция через Deepgram nova-3
- 🔊 Захват звука встречи (поделитесь экраном — работает на Windows автоматически)
- ⚡ Подсказки в реальном времени через Gemini 2.5 Flash Lite (OpenRouter)
- 📋 Генерация плана интервью перед звонком
- 🗂 Отметить вопрос как заданный — кликом в панели плана
- Overlay поверх всех окон, полупрозрачный, draggable

## Запуск

```bash
# 1. Создайте .env
cp .env.example .env
# Заполните DEEPGRAM_API_KEY и OPENROUTER_API_KEY

# 2. Установите зависимости
npm install

# 3. Запустите
npm start
```

## Сборка (exe / dmg)

```bash
# Windows .exe
npm run build:win

# macOS .dmg
npm run build:mac
```

## API ключи

| Ключ | Где взять |
|------|-----------|
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) — free tier: 200 часов |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) — Gemini Flash Lite очень дёшевый |

## Сценарии использования

### Рекрутинг
- Вставьте резюме кандидата и описание вакансии
- Создайте план интервью → система предложит 8–14 вопросов по блокам
- Во время звонка: система слышит разговор и подсказывает уточняющие вопросы

### Интервью с экспертом в незнакомой теме
- Подготовьте базовые вопросы
- Система в реальном времени подсказывает "уточните про X", "спросите про Y"
- Не нужно быть экспертом — AI задаёт глубину

### Любой звонок где нужна структура
- Медицинские интервью
- Технические аудиты
- Журналистские интервью

## Архитектура

```
main.js (Electron main)
  ├─ Создаёт Setup window (480×740, top-right)
  ├─ Создаёт Overlay window (380×340, alwaysOnTop, transparent)
  ├─ Проксирует OpenRouter API calls (обходит CORS)
  └─ Читает .env → передаёт ключи через IPC

renderer/setup.html
  └─ Форма: имя, длительность, резюме, JD, язык
  └─ Генерация плана через OpenRouter (через IPC)

renderer/overlay.html
  ├─ Mic: getUserMedia → AudioWorklet → PCM Int16 → Deepgram WS
  ├─ System audio: getDisplayMedia → AudioWorklet → отдельный Deepgram WS
  └─ Транскрипты → каждые 2 финальных → OpenRouter tips

renderer/audio-processor.js (AudioWorklet)
  └─ Float32 → Int16 PCM conversion
```

## Отличия от Swift-версии

| | Swift (Mac) | Electron (Win/Mac) |
|--|--|--|
| Системный звук | ScreenCaptureKit (автоматически) | getDisplayMedia (нужно поделиться экраном) |
| Установка | .dmg | .exe / .dmg |
| Оффлайн | Нет (нужны Deepgram + OpenRouter) | Нет |
| Производительность | Нативная | Chrome-based |
| Тray icon | MenuBarExtra | Electron Tray |

## Тестирование на Windows VM (GCP)

```bash
# Создать Windows VM на GCP
gcloud compute instances create call-tips-test \
  --image-family=windows-2022 \
  --image-project=windows-cloud \
  --machine-type=n2-standard-2 \
  --zone=europe-west1-b

# RDP подключение
gcloud compute rdp call-tips-test --zone=europe-west1-b
```

После RDP:
1. Установить Node.js 20+ с nodejs.org
2. `git clone` репо или скопировать файлы
3. `npm install && npm start`
