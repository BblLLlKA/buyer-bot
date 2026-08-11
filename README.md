# buyer-bot

Telegram-бот на grammY с регистрацией через подтверждение администратором,
ролевой моделью (`buyer` / `admin`), сбором AIO UUID, привязкой доменов к
кампаниям через AIO API, inline-меню в виде "экранов" и очередями на BullMQ.

## Стек

- Node.js 20+, TypeScript
- [grammY](https://grammy.dev/) — Telegram Bot Framework
- [@grammyjs/conversations](https://grammy.dev/plugins/conversations) — диалоги ввода AIO UUID и привязки доменов
- MongoDB (Mongoose) — хранение пользователей
- Redis — session-хранилище grammY (`@grammyjs/storage-redis`) и очереди BullMQ
- BullMQ — асинхронная рассылка уведомлений админам и привязка доменов к кампаниям через AIO API

## Структура проекта

```
src/
  bot/            сборка Bot-инстанса, регистрация всех обработчиков
  config/         env, логгер
  conversations/  диалоги grammY: ввод AIO UUID, привязка доменов к кампаниям
  db/             подключения к MongoDB и Redis
  handlers/       обработчики команд и callback_query
  keyboards/      построение inline-клавиатур
  middlewares/    session, проверка статуса пользователя, admin-only
  models/         Mongoose-схемы
  queues/         BullMQ очереди + воркеры (рассылка админам, привязка доменов)
  screens/        рендер текста + клавиатуры для каждого "экрана"
  services/       бизнес-логика: пользователи, админы, карточки заявок, AIO API
  types/          типы сессии и контекста grammY (включая ConversationFlavor)
  utils/          safeEdit — edit-or-reply с фолбэком
  index.ts        точка входа
```

## Запуск через Docker Compose

1. Скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN` и `ADMIN_IDS`.
2. Запустите:

   ```bash
   docker compose up --build
   ```

   Поднимутся MongoDB, Redis и сам бот.

## Локальный запуск (без Docker)

Понадобится локально запущенный MongoDB и Redis (см. `docker-compose.yml`,
можно поднять только их: `docker compose up mongo redis`).

```bash
npm install
cp .env.example .env   # заполнить BOT_TOKEN, ADMIN_IDS
npm run dev             # разработка, tsx watch
# или
npm run build && npm start
```

## Переменные окружения

| Переменная  | Описание                                                        |
|-------------|------------------------------------------------------------------|
| `BOT_TOKEN` | Токен бота от @BotFather                                         |
| `MONGO_URI` | Строка подключения к MongoDB                                     |
| `REDIS_URL` | Строка подключения к Redis                                       |
| `ADMIN_IDS` | Telegram ID первичных админов через запятую (upsert при старте)  |
| `LOG_LEVEL` | Уровень логирования pino (по умолчанию `info`)                   |
| `AIO_API_BASE_URL` | Базовый URL AIO API (по умолчанию `https://app.aio.tech/api/v1`) |
| `AIO_API_TOKEN` | JWT для авторизации в AIO API (используется как `Cookie: token=...`) |

Без `AIO_API_TOKEN` бот полностью работоспособен — не заработает только
привязка доменов к кампаниям (шаг 2 ниже).

## Ключевые решения

### Регистрация и race condition

Обработка заявки одним из нескольких администраторов — атомарная операция:
`findOneAndUpdate({ telegramId, status: 'pending' }, { status: decision, ... })`
(см. `src/services/userService.ts#resolveRegistration`). Если два админа жмут
кнопки почти одновременно, выигрывает только первый — второй получает `null`
и видит актуальную карточку вместо повторной обработки.

Карточка заявки рассылается всем админам (`src/queues/notifyWorker.ts`), и
для каждой отправки в документ пользователя добавляется пара
`{ adminId, messageId }` (`notifiedAdmins`). Как только заявку кто-то
обработал, по этому списку редактируются карточки у всех остальных админов
(`src/handlers/registrationCallbacks.ts`), чтобы не осталось "живых" кнопок
на уже закрытую заявку.

### Экраны и редактирование сообщений

Каждый "экран" — функция, возвращающая `{ text, keyboard }`
(`src/screens/*.ts`). `renderScreen` (`src/utils/safeEdit.ts`) сначала
пытается отредактировать сообщение, из которого пришёл callback; при ошибках
`message is not modified` — игнорирует, при `message to edit not found` /
`message can't be edited` / `query is too old` — отправляет новое сообщение.

### Ролевая модель

`userStatusMiddleware` (`src/middlewares/userStatus.ts`) подгружает
пользователя по `telegramId` на каждый апдейт и блокирует доступ для
`pending` / `awaiting_uuid` / `rejected` / `banned` (кроме команды `/start`).
`adminOnly` (`src/middlewares/adminOnly.ts`) дополнительно ограничивает
admin-callback'и ролью `admin`.

### Ввод AIO UUID (регистрация в два шага)

Подтверждение заявки больше не сразу переводит пользователя в `approved`, и
UUID теперь вводит **сам админ**, а не заявитель:

1. Админ жмёт "✅ Подтвердить" → атомарный переход `pending → awaiting_uuid`
   с записью `processedBy` (`src/handlers/registrationCallbacks.ts#registrationApproveHandler`,
   та же гонка-защита через `findOneAndUpdate`, что и раньше). Заявителю
   пока ничего не отправляется — карточка заявки у всех админов
   обновляется на "✅ Подтверждено, ожидает AIO UUID — @admin", кнопки с неё
   убираются, чтобы другой админ не начал обрабатывать её параллельно.
2. У **этого же админа**, в его собственном чате, сразу заводится диалог
   `aioUuidForUserConversation` (`src/conversations/aioUuidForUserConversation.ts`)
   — вход происходит из того же callback-обработчика, поэтому кросс-чатных
   трюков не нужно (в отличие от более ранней версии, где ждать ответа
   приходилось от заявителя в другом чате).
3. Диалог явно показывает админу, для кого именно вводится UUID (username/ID
   заявителя — на случай, если админ параллельно обрабатывает несколько
   заявок), валидирует формат (regex UUID) и переспрашивает при ошибке.
   Если введённый UUID уже привязан к другому пользователю — это не
   ошибка (`aioUserUUID` не unique: один AIO-аккаунт может стоять за
   несколькими Telegram-аккаунтами), но админа предупреждают и просят
   отправить тот же UUID повторно для подтверждения.
4. Только после успешного сохранения — атомарный переход
   `awaiting_uuid → approved` (`approveWithAioUuid`), синхронизация карточек
   у всех админов (финальный статус "✅ Подтверждено, AIO UUID сохранён") и
   **единственное** уведомление заявителю — новым сообщением с текстом
   подтверждения и главным меню.
5. `/cancel` в любой момент диалога атомарно возвращает пользователя в
   `pending` (`revertToPending`, проверяет, что лок держит именно этот
   админ) и карточка снова становится кликабельной для любого админа. Если
   админ вместо ответа нажимает другую кнопку (например, уходит в главное
   меню), это тоже не блокирует его: `conversation.waitFor(..., { next: true })`
   пропускает такой апдейт в обычную обработку, а диалог остаётся
   "приостановленным" и ждёт either текстового ответа, либо `/cancel` —
   произвольного тайм-аута/автоотмены по неактивности нет (см. "Известные
   упрощения").

Для администраторов ввод собственного UUID не менялся: они уже `approved`
сразу при старте (см. `ensurePrimaryAdmins`), диалог `aioUuidConversation`
(`src/conversations/aioUuidConversation.ts`) заводится напрямую из
обработчика `/start` (`src/handlers/start.ts`), без статуса `awaiting_uuid`
и без карточек — только сохранение `aioUserUUID`.

### Привязка доменов к кампаниям

Кнопка "🔗 Подключить домен к кампании" в главном меню доступна покупателю,
у которого уже есть `aioUserUUID`. Диалог `domainCampaignConversation`
(`src/conversations/domainCampaignConversation.ts`):

1. Просит список ID кампаний (через запятую или с новой строки).
2. Просит столько же доменов, в том же порядке; при несовпадении количества
   просит ввести домены заново (до 5 попыток).
3. На каждую пару `{campaignId, domain}` отправляет отдельное сообщение со
   статусом и ставит отдельную задачу в очередь `domain-campaign-linking`.

Воркер (`src/queues/domainCampaignWorker.ts`) на каждом шаге редактирует то
самое сообщение, дописывая строку статуса: поиск кампании → проверка
владельца (`campaign.owner.uuid === user.aioUserUUID`) → поиск домена →
привязка через AIO `Domain\Edit`. Бизнес-отказы (кампания/домен не найдены,
кампания чужая, `Domain\Edit` не подтвердил успех) — это **финальный**
статус, job завершается штатно и не ретраится. Ретраится только реальная
ошибка обращения к AIO API (`attempts: 3`, экспоненциальный backoff) — на
последней попытке сообщение помечается как "❌ Техническая ошибка".

Вся работа с AIO API вынесена в `src/services/aioApi.ts`
(`findCampaignById`, `findDomainByName`, `linkDomainToCampaign`) — HTTP,
заголовки и логирование запросов/ответов не размазаны по воркеру.

### Очереди

`enqueueAdminNotification` кладёт задачу в BullMQ вместо синхронной рассылки
всем админам внутри обработчика `/start` — рассылка идёт в воркере
(`src/queues/notifyWorker.ts`) с ретраями (`attempts: 5`, экспоненциальный
backoff) при сбоях Telegram API. `domain-campaign-linking`
(`src/queues/domainCampaignQueue.ts`) работает по тому же принципу для
привязки доменов (см. выше).

## Известные упрощения

- Middleware проверки статуса делает запрос в MongoDB на каждый апдейт —
  для продакшена стоит закэшировать роль/статус в Redis с коротким TTL.
- Поиск пользователей — простой `$regex` по `username` + точное совпадение
  по `telegramId`, без полнотекстового индекса.
- `monitoring_user_uuid` в запросе `Domain\Edit` — фиксированная константа
  из примера AIO API (`src/services/aioApi.ts`), не привязана к
  конкретному пользователю; если AIO ожидает других значений по клиенту —
  вынести в конфиг.
- Если админ подтвердил заявку, но никогда не завершает ввод AIO UUID (не
  шлёт /cancel, просто исчезает) — заявка бессрочно остаётся в
  `awaiting_uuid`, залоченная на него. Recovery только вручную (например,
  через Mongo shell сбросить `status`/`processedBy`) или через `/cancel` от
  того же админа. Автоматического тайм-аута/эскалации на другого админа
  нет — потребует отдельной delayed-job в BullMQ.
