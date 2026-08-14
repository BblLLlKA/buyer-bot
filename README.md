# buyer-bot

Telegram-бот на grammY с регистрацией через подтверждение администратором,
ролевой моделью (`buyer` / `admin`), сбором AIO UUID, привязкой доменов к
кампаниям через AIO API, покупкой доменов через Namecheap с настройкой
Cloudflare (зона + NS) и автодобавлением в AIO, inline-меню в виде "экранов"
и очередями на BullMQ.

См. [`AUDIT.md`](./AUDIT.md) за результатами аудита кода: список найденных
проблем по категориям (корректность, безопасность, производительность,
качество кода), что из этого исправлено в коде, а что оставлено как
осознанная рекомендация на будущее.

## Стек

- Node.js 20+, TypeScript
- [grammY](https://grammy.dev/) — Telegram Bot Framework
- [@grammyjs/conversations](https://grammy.dev/plugins/conversations) — диалоги ввода AIO UUID, привязки доменов и покупки доменов
- MongoDB (Mongoose) — хранение пользователей
- Redis — session-хранилище grammY (`@grammyjs/storage-redis`) и очереди BullMQ
- BullMQ — асинхронная рассылка уведомлений админам, привязка доменов к кампаниям и покупка доменов через AIO/Namecheap/Cloudflare API
- `xml2js` — разбор XML-ответов Namecheap API

## Структура проекта

```
src/
  bot/            сборка Bot-инстанса, регистрация всех обработчиков
  config/         env, логгер, цены за домены по зонам
  conversations/  диалоги grammY: ввод AIO UUID, привязка доменов к кампаниям, покупка доменов
  db/             подключения к MongoDB и Redis
  handlers/       обработчики команд и callback_query
  keyboards/      построение inline-клавиатур
  middlewares/    session, проверка статуса пользователя, admin-only
  models/         Mongoose-схемы
  queues/         BullMQ очереди + воркеры (рассылка админам, привязка доменов, покупка доменов)
  screens/        рендер текста + клавиатуры для каждого "экрана"
  services/       бизнес-логика: пользователи, админы, карточки заявок, AIO API, Namecheap API,
                  Cloudflare API
  types/          типы сессии и контекста grammY (включая ConversationFlavor)
  utils/          safeEdit (edit-or-reply с фолбэком), валидация доменов/IP/UUID, генератор
                  доменов, парсинг списков, прогресс-сообщения воркеров, маскирование секретов
  index.ts        точка входа
data/
  domain-words.txt  словарь для генератора доменных имён (см. "Покупка доменов")
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
| `AIO_DNS_PROVIDER_UUID` | Фиксированный `dns_provider_uuid` для `Domain\CreateManually` (покупка доменов) |
| `AIO_MONITORING_USER_UUID` | Фиксированный `monitoring_user_uuid` для `Domain\CreateManually` (покупка доменов) |
| `NAMECHEAP_USERNAME` | Namecheap `ApiUser`/`UserName` |
| `NAMECHEAP_API_KEY` | Namecheap `ApiKey` |
| `NAMECHEAP_CLIENT_IP` | IP, добавленный в whitelist Namecheap API |
| `NAMECHEAP_CONTACT_*` | Контакт Registrant/Tech/Admin/AuxBilling для регистрации домена (обязателен Namecheap-ом) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API-токен с правом `Zone:Edit` (account-scoped token, не legacy global API key) |
| `CLOUDFLARE_API_BASE_URL` | Базовый URL Cloudflare API (по умолчанию `https://api.cloudflare.com/client/v4`) |
| `MAX_DOMAINS_PER_REQUEST` | Максимум доменов за один запрос генерации/ручного ввода (по умолчанию `50`) |
| `DOMAIN_PRICE_COM` / `_INFO` / `_ORG` / `_DEFAULT` | Оценочная цена домена по зоне — используется только для быстрого отказа, если баланса аккаунта Namecheap явно не хватает |

Без `AIO_API_TOKEN` бот полностью работоспособен — не заработает только
привязка доменов к кампаниям и покупка доменов (см. ниже). Без переменных
`NAMECHEAP_*` не заработает только покупка доменов. Без `CLOUDFLARE_API_TOKEN`
покупка доменов будет доходить до шага "Добавление домена в Cloudflare" и
падать на нём с явной ошибкой — Namecheap-покупка при этом уже состоится, так
что не оставляйте эту переменную пустой, если фича включена.

## Логирование

Структурированное логирование через [pino](https://getpino.io/)
(`src/config/logger.ts`). В dev (`NODE_ENV !== production`) вывод идёт через
`pino-pretty` (цветной, читаемый построчно); в production — чистый JSON в
stdout, готовый к сбору любым log-шиппером (Loki, ELK, CloudWatch и т.п.).

- **Уровень** — `LOG_LEVEL` в `.env` (`fatal|error|warn|info|debug|trace`,
  по умолчанию `info`). Чтобы увидеть тела запросов/ответов AIO и Namecheap
  API, все шаги диалогов и промежуточные значения — выставите `LOG_LEVEL=debug`
  и перезапустите бота (`docker compose restart bot` или `npm run dev`).
- **`module`** — у каждого логгера есть дочерний контекст по слою
  (`logger.child({ module: '...' })`), например `handler:registration`,
  `conversation:domain-purchase`, `service:aioApi`, `worker:domain-purchase`,
  `middleware:auth`, `db`, `queue`. По этому полю удобно фильтровать вывод
  (`| grep '"module":"worker:domain-purchase"'` или through jq).
- **`requestId`** — на каждый Telegram-апдейт (значение — `update_id`),
  автоматически попадает во все логи, порождённые обработкой этого апдейта
  (включая вложенные вызовы сервисов), через `AsyncLocalStorage` + pino
  `mixin`. Позволяет выцепить полный след одного нажатия кнопки/сообщения:
  `| grep '"requestId":12345'`.
- **`jobId`** — то же самое, но на каждую задачу BullMQ; позволяет собрать
  все строки одного прогресс-сообщения воедино независимо от ретраев.
- **`category: "billing"`** — стоит на логах, связанных с деньгами (проверка
  баланса Namecheap, факт покупки домена, отказ по недостатку средств) —
  отдельный признак для алертинга/аудита финансовых операций, не завязанный
  на конкретный `module`.
- **Маскирование** — pino `redact` (в `config/logger.ts`) вычищает поля вида
  `*.token`/`*.apiKey`/`*.headers.Cookie` из любого залогированного объекта
  на случай, если он туда попадёт целиком; `src/utils/maskSensitive.ts` — для
  точечного маскирования строк (например, в тексте ошибки).
- Необработанные ошибки вне `bot.catch()` (например, забытый `await`) ловятся
  глобально в `src/index.ts` (`process.on('unhandledRejection'/'uncaughtException')`)
  и тоже пишутся структурированным логом, а не голым stack trace в stderr.

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
у которого уже есть `aioUserUUID`, и всегда доступна админу (он получает
`aioUserUUID` ещё до того, как видит главное меню — см. выше). Для покупателя
кнопка сразу ведёт в диалог сбора кампаний/доменов; у админа сначала
появляется выбор (`src/screens/linkDomainsChoice.ts`):

- **🙋 За себя** — то же самое, что у покупателя, только с `aioUserUUID`
  самого админа (`linkDomainsSelfHandler`).
- **👤 За другого пользователя** — диалог `domainCampaignForUserConversation`
  (`src/conversations/domainCampaignForUserConversation.ts`) сначала просит
  username/ID нужного пользователя (поиск через `searchUserProfiles`, с
  переспросом при 0/несколько совпадений или если у найденного пользователя
  ещё нет `aioUserUUID`), а затем продолжает тем же общим сценарием.

Сам сценарий сбора кампаний/доменов вынесен в отдельную переиспользуемую
функцию `collectAndQueueDomainCampaignPairs` (`src/conversations/domainCampaignConversation.ts`),
которую вызывают оба пути — и "за себя", и "за другого пользователя":

1. Просит список ID кампаний (через запятую или с новой строки).
2. Просит столько же доменов, в том же порядке; при несовпадении количества
   просит ввести домены заново (до 5 попыток).
3. На каждую пару `{campaignId, domain}` отправляет отдельное сообщение со
   статусом и ставит отдельную задачу в очередь `domain-campaign-linking`.

Во всех случаях прогресс-сообщения приходят **в чат того, кто ведёт диалог**
(админу), даже когда используется `aioUserUUID` другого пользователя.

Воркер (`src/queues/domainCampaignWorker.ts`) на каждом шаге редактирует то
самое сообщение, дописывая строку статуса: поиск кампании → проверка
владельца (`campaign.owner.uuid === aioUserUUID`) → поиск домена → привязка
через AIO `Domain\Edit`. Бизнес-отказы (кампания/домен не найдены, кампания
чужая, не хватает `owner`/`_identity` в ответе AIO, `Domain\Edit` не
подтвердил успех) — это **финальный** статус, job завершается штатно и не
ретраится. Если у кампании нет `detectedSource` (AIO ещё не определил
источник трафика) — это не отказ, а просто используется дефолтный
`sourceUuid` (константа в `domainCampaignWorker.ts`). Ретраится только
реальная ошибка обращения к AIO API (`attempts: 3`, экспоненциальный
backoff) — на последней попытке сообщение помечается как "❌ Техническая
ошибка".

Вся работа с AIO API вынесена в `src/services/aioApi.ts`
(`findCampaignById`, `findDomainByName`, `linkDomainToCampaign`) — HTTP,
заголовки и логирование запросов/ответов не размазаны по воркеру.

### Покупка доменов через Namecheap

Кнопка "🛒 Купить домены" в главном меню видна только `admin`; коллбэк
`menu:buyDomains` дополнительно защищён `adminOnly` на случай гонки при смене
роли или устаревшего callback_data. `aioUserUUID`, от имени которого домены
добавляются в AIO, берётся у инициирующего админа (тем же способом, что и в
привязке доменов к кампаниям — читается из `ctx.auth` до входа в диалог и
передаётся аргументом, см. "Ловушка" ниже).

Диалог `buyDomainsConversation` (`src/conversations/buyDomainsConversation.ts`):

1. Выбор способа — сгенерировать (`🎲`) или ввести вручную (`✏️`).
2. **Генерация**: количество (лимит `MAX_DOMAINS_PER_REQUEST`) → зона
   (`.com`/`.info`/`.org`/ввод вручную с валидацией формата) → генерация через
   `src/utils/domainGenerator.ts` (портировано из `support-bot`'s
   `generate-domains.js` — тот же словарь + слоги + суффиксы, тот же
   алгоритм) → экран подтверждения списка с кнопками "✅ Подтвердить" /
   "🔄 Сгенерировать заново" / "❌ Отмена" (в задании это было опциональным
   UX-улучшением — решили оставить, чтобы админ не покупал домены вслепую).
3. **Вручную**: список доменов через запятую/с новой строки (тот же парсер,
   что и в привязке доменов к кампаниям), базовая валидация формата.
4. Общий шаг — IP-адрес сервера (валидация IPv4 через `net.isIPv4`).
5. На каждый домен отдельное сообщение "⏳ Задача поставлена в очередь..." и
   отдельная задача в очереди `domain-purchase`
   (`src/queues/domainPurchaseQueue.ts`), с ценой (`getDomainPrice`,
   `src/config/domainPricing.ts`) уже посчитанной на момент постановки в
   очередь — чтобы обработка не зависела от того, поменяется ли конфиг цен
   к моменту, когда воркер доберётся до этой задачи.

Воркер (`src/queues/domainPurchaseWorker.ts`) на каждом шаге редактирует то
самое сообщение:

1. 💳 Проверка баланса Namecheap.
2. 🛒 Покупка домена в Namecheap.
3. ☁️ Добавление домена в Cloudflare (`ensureZoneWithNameservers` в
   `src/services/cloudflareApi.ts`) — создаёт zone и забирает назначенные
   Cloudflare NS-серверы.
4. 🔄 Прописывание этих NS-серверов в Namecheap для домена (`setCustomDns` в
   `src/services/namecheapApi.ts`, команда `namecheap.domains.dns.setCustom`).
5. 🔍 Поиск сервера в AIO по IP (`findServerByIp`).
6. ➕ Добавление домена в AIO (`createDomainManually`, action
   `Domain\CreateManually`, единственный запрос к AIO в проекте, отправляемый
   как `multipart/form-data`, а не JSON, — см. `src/services/aioApi.ts`).

Пример финального сообщения при успехе:

```
🌐 Домен: test21.com

✅ Баланс Namecheap достаточен ($123.45)
✅ Домен куплен в Namecheap
✅ Домен добавлен в Cloudflare
✅ NS-серверы обновлены в Namecheap (ns1.cloudflare.com, ns2.cloudflare.com)
✅ Сервер найден в AIO
✅ Домен успешно добавлен в AIO
```

Бизнес-отказы (баланс, домен занят, ошибка Cloudflare, домен уже
зарегистрирован в Cloudflare на другом зонировании, ошибка `setCustom` в
Namecheap, сервер не найден, `validation_errors` от AIO) — финальный статус,
без ретрая; сообщение в каждом случае явно указывает, что из шагов 1–4 уже
выполнено, а что нет (например: "домен куплен в Namecheap, но не настроен" —
если упал шаг 3, или "домен куплен и добавлен в Cloudflare, но NS не
обновлены — требуется ручная проверка" — если упал шаг 4). Ретраится только
сетевая/HTTP-ошибка Namecheap, Cloudflare или AIO (`attempts: 3`,
экспоненциальный backoff).

**Баланс — это реальный баланс аккаунта Namecheap** (`namecheap.users.getBalances`,
`getAvailableBalance` в `src/services/namecheapApi.ts`), общий на все покупки,
а не что-то, что бот считает сам за каждого админа отдельно (более раннее
решение с полем `User.balance` было заменено на это). Цена из
`DOMAIN_PRICE_*` — только локальная оценка для быстрого отказа до похода в
Namecheap; реальная и авторитетная проверка — сам вызов покупки, который
Namecheap отклонит с `NamecheapApiError`, если на счету действительно не
хватает денег.

Так как покупка домена и его DNS-настройка не идемпотентны (нельзя купить
один и тот же домен дважды; повторная настройка NS — не ошибка, но не нужна),
воркер сохраняет прогресс в данные задачи через `job.updateData(...)`:
`purchased: true` — сразу после успешной покупки в Namecheap; `nameservers`
(сам список, полученный от Cloudflare) — сразу после того, как оба шага 3 и 4
успешно завершились. Если следующий шаг упадёт с технической ошибкой и BullMQ
повторит всю задачу, повторный запуск видит эти флаги и не повторяет уже
выполненные шаги — сразу переходит к следующему.

Отдельно от этого флага, сам шаг 3 идемпотентен и на уровне Cloudflare:
`ensureZoneWithNameservers` сначала ищет зону по имени домена и только если
её нет — создаёт; если создание всё же наткнётся на "zone already exists"
(гонка между поиском и созданием, например из-за незакоммиченного
предыдущего прогона той же job), эта конкретная ошибка не считается
фатальной — воркер просто забирает NS уже существующей зоны и продолжает.

Namecheap-клиент (`src/services/namecheapApi.ts`) портирован из
`support-bot`'s `namecheap.service.js` — те же параметры авторизации
(`ApiUser`/`ApiKey`/`UserName`/`ClientIp`), тот же разбор XML-ответа через
`xml2js`, а `setCustomDns` — то же самое, что `setCustomDns` в
`support-bot`'s клиенте (команда `namecheap.domains.dns.setCustom`, домен
разбирается на `SLD`/`TLD`). WhoisGuard намеренно никогда не включается
(`WGEnabled` не передаётся) — в `support-bot` был фолбэк на повторную покупку
без него при ошибке "не поддерживается для зоны", здесь эта ветка не нужна,
так как WhoisGuard не запрашивается вообще.

Cloudflare-клиент (`src/services/cloudflareApi.ts`) портирован из
`support-bot`'s `cloudflare.service.js` — тот же bearer-токен
(`CLOUDFLARE_API_TOKEN`, без account ID — эндпоинты `/zones` уже скопированы
под сам токен) и тот же find-or-create-зона паттерн (`ensureZone` там →
`ensureZoneWithNameservers` здесь). В отличие от `support-bot`, здесь **не**
создаётся A-запись и не включается Always Use HTTPS — DNS-запись домена
дальше настраивает AIO (шаг 6), Cloudflare в этом флоу нужен только чтобы
получить его NS-серверы для Namecheap.

Внутренний слой retry/circuit-breaker из `support-bot` (и для Namecheap, и
для Cloudflare) не портировался — сетевые ретраи в этом проекте уже
происходят на уровне BullMQ (см. выше), как и для AIO API.

### Очереди

`enqueueAdminNotification` кладёт задачу в BullMQ вместо синхронной рассылки
всем админам внутри обработчика `/start` — рассылка идёт в воркере
(`src/queues/notifyWorker.ts`) с ретраями (`attempts: 5`, экспоненциальный
backoff) при сбоях Telegram API. `domain-campaign-linking`
(`src/queues/domainCampaignQueue.ts`) и `domain-purchase`
(`src/queues/domainPurchaseQueue.ts`) работают по тому же принципу для
привязки и покупки доменов соответственно (см. выше).

### Ловушка: `ctx.auth` и `conversation.external()` внутри диалогов

Две вещи, о которых легко забыть при добавлении новых `conversations/*.ts`:

- **`ctx.conversation.enter()` не переносит кастомные поля контекста.**
  Внутрь диалога попадают только `update`/`api`/`me` — `ctx.auth`
  (выставляется `userStatusMiddleware`) там `undefined`. Всё, что нужно
  диалогу из внешнего контекста (роль, `aioUserUUID` и т.п.), нужно прочитать
  в обработчике **до** `enter()` и передать аргументом (так делают
  `linkDomainsCallbacks.ts`, `registrationApproveHandler`).
- **`conversation.external()` клонирует возвращаемое значение через
  `structuredClone`.** Mongoose-документы, `DocumentArray` и BullMQ `Job` —
  не клонируются, конкретно даёт `DataCloneError`. Внутри `external()` нужно
  возвращать заранее собранный plain-object (см. `toPlainRegistrationCardUser`
  в `src/services/registrationCards.ts`, `searchUserProfiles`/`UserProfileLean`
  в `src/services/userService.ts`), а не документ/результат запроса как есть.

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
- Проверка баланса Namecheap перед покупкой — это только предварительный
  отказ, не резервирование средств: если несколько доменов покупаются
  параллельно на грани реального баланса, каждая задача независимо видит
  "баланс достаточен", и лишь фактический вызов покупки в Namecheap
  авторитетно решает, хватило ли денег (см. "Ключевые решения").
- Namecheap-покупка домена не проверяется на доступность заранее — ошибка
  "домен уже занят" всплывает только на шаге покупки и просто завершает
  задачу как финальный отказ.
