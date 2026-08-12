import { InlineKeyboard } from "grammy";
import type { MyContext, MyConversation } from "../types";
import { env } from "../config/env";
import { getDomainPrice } from "../config/domainPricing";
import { generateDomains } from "../utils/domainGenerator";
import { isValidDomain, isValidIpv4, normalizeZone, parsePositiveInt } from "../utils/domainValidation";
import { enqueueDomainPurchase } from "../queues/domainPurchaseQueue";
import { parseList } from "../utils/parseList";
import { logger } from "../config/logger";

const log = logger.child({ module: "conversation:domain-purchase" });

export const BUY_DOMAINS_CONVERSATION_NAME = "buyDomainsConversation";

const ZONE_BUTTONS: [label: string, zone: string][] = [
  ["🌍 .com", ".com"],
  ["💻 .info", ".info"],
  ["🔗 .org", ".org"],
];

/** Admin-only entry point: purchase one or more domains via Namecheap and add them to AIO. */
export async function buyDomainsConversation(
  conversation: MyConversation,
  ctx: MyContext,
  aioUserUUID: string,
): Promise<void> {
  const adminTelegramId = ctx.from?.id;
  log.debug({ adminTelegramId, aioUserUUID }, "Started buyDomainsConversation");

  const sourceKeyboard = new InlineKeyboard()
    .text("🎲 Сгенерировать домены", "buydomains:generate")
    .row()
    .text("✏️ Написать вручную", "buydomains:manual")
    .row()
    .text("❌ Отмена", "buydomains:cancel");

  await ctx.reply("🛒 <b>Купить домены</b>\n\nВыберите способ:", {
    reply_markup: sourceKeyboard,
    parse_mode: "HTML",
  });

  const sourceAnswer = await conversation.waitForCallbackQuery([
    "buydomains:generate",
    "buydomains:manual",
    "buydomains:cancel",
  ]);
  await sourceAnswer.answerCallbackQuery();

  let domains: string[] | null = null;
  if (sourceAnswer.callbackQuery.data === "buydomains:generate") {
    log.debug({ adminTelegramId }, "Buy-domains: generate branch selected");
    domains = await handleGenerateBranch(conversation, ctx);
  } else if (sourceAnswer.callbackQuery.data === "buydomains:manual") {
    log.debug({ adminTelegramId }, "Buy-domains: manual branch selected");
    domains = await handleManualBranch(conversation, ctx);
  } else {
    log.debug({ adminTelegramId }, "Buy-domains: cancelled at source selection");
    await ctx.reply("❌ Операция отменена.");
    return;
  }

  if (!domains) return; // cancelled inside a branch

  await collectIpAndQueue(conversation, ctx, domains, aioUserUUID);
}

async function waitForDomainCount(conversation: MyConversation, ctx: MyContext): Promise<number> {
  await ctx.reply(`🔢 Укажите количество доменов для генерации (максимум ${env.maxDomainsPerRequest}):`);
  while (true) {
    const current = await conversation.waitFor("message:text");
    const count = parsePositiveInt(current.message.text);
    if (count === null) {
      await current.reply("❌ Введите положительное целое число. Попробуйте снова:");
      continue;
    }
    if (count > env.maxDomainsPerRequest) {
      await current.reply(`❌ Максимум ${env.maxDomainsPerRequest} доменов за раз. Попробуйте снова:`);
      continue;
    }
    return count;
  }
}

/** Returns the chosen zone, or null if the user cancelled. */
async function selectZone(conversation: MyConversation, ctx: MyContext): Promise<string | null> {
  const keyboard = new InlineKeyboard();
  for (const [label, zone] of ZONE_BUTTONS) {
    keyboard.text(label, `zone:${zone}`);
  }
  keyboard.row().text("✏️ Ввести вручную", "zone:manual").row().text("❌ Отмена", "zone:cancel");

  await ctx.reply("🌐 Выберите доменную зону:", { reply_markup: keyboard });

  const zoneAnswer = await conversation.waitForCallbackQuery([
    ...ZONE_BUTTONS.map(([, zone]) => `zone:${zone}`),
    "zone:manual",
    "zone:cancel",
  ]);
  await zoneAnswer.answerCallbackQuery();

  if (zoneAnswer.callbackQuery.data === "zone:cancel") return null;

  if (zoneAnswer.callbackQuery.data === "zone:manual") {
    await zoneAnswer.reply("Введите зону вручную (например .net):");
    while (true) {
      const current = await conversation.waitFor("message:text");
      const zone = normalizeZone(current.message.text);
      if (!zone) {
        await current.reply("❌ Некорректный формат зоны. Пример: .net. Попробуйте снова:");
        continue;
      }
      return zone;
    }
  }

  return zoneAnswer.callbackQuery.data.replace("zone:", "");
}

/** Generates domains, lets the admin confirm/regenerate/cancel, and returns the confirmed list (or null if cancelled). */
async function handleGenerateBranch(conversation: MyConversation, ctx: MyContext): Promise<string[] | null> {
  const count = await waitForDomainCount(conversation, ctx);
  const zone = await selectZone(conversation, ctx);
  if (!zone) {
    await ctx.reply("❌ Операция отменена.");
    return null;
  }

  while (true) {
    const domains = await conversation.external(() => generateDomains(count, zone));

    const keyboard = new InlineKeyboard()
      .text("✅ Подтвердить", "confirm:ok")
      .row()
      .text("🔄 Сгенерировать заново", "confirm:retry")
      .text("❌ Отмена", "confirm:cancel");

    await ctx.reply(`✨ Сгенерированные домены (${domains.length}):\n\n${domains.join("\n")}`, {
      reply_markup: keyboard,
    });

    const confirmAnswer = await conversation.waitForCallbackQuery(["confirm:ok", "confirm:retry", "confirm:cancel"]);
    await confirmAnswer.answerCallbackQuery();

    if (confirmAnswer.callbackQuery.data === "confirm:cancel") {
      log.debug({ telegramId: ctx.from?.id, count, zone }, "Buy-domains: cancelled at generated-list confirmation");
      await ctx.reply("❌ Операция отменена.");
      return null;
    }
    if (confirmAnswer.callbackQuery.data === "confirm:retry") {
      log.debug({ telegramId: ctx.from?.id, count, zone }, "Buy-domains: regenerating domain list");
      continue;
    }

    log.debug({ telegramId: ctx.from?.id, count, zone, domains }, "Buy-domains: generated list confirmed");
    return domains;
  }
}

async function handleManualBranch(conversation: MyConversation, ctx: MyContext): Promise<string[] | null> {
  await ctx.reply("✍️ Введите домены вручную (каждый с новой строки или через запятую):");

  while (true) {
    const current = await conversation.waitFor("message:text");

    const rawCandidates = parseList(current.message.text).map((d) => d.toLowerCase());
    if (rawCandidates.length === 0) {
      await current.reply("❌ Не удалось распознать ни одного домена. Попробуйте снова:");
      continue;
    }
    if (rawCandidates.length > env.maxDomainsPerRequest) {
      await current.reply(`❌ Максимум ${env.maxDomainsPerRequest} доменов за раз. Попробуйте снова:`);
      continue;
    }
    const invalid = rawCandidates.filter((d) => !isValidDomain(d));
    if (invalid.length > 0) {
      await current.reply(`❌ Некорректный формат доменов: ${invalid.join(", ")}. Попробуйте снова:`);
      continue;
    }

    // Dedupe: a domain listed twice would otherwise queue two separate
    // purchase jobs for the same domain — a real double-charge attempt
    // against Namecheap, not just a harmless duplicate. See AUDIT.md 1.1 #3.
    const candidates = [...new Set(rawCandidates)];
    if (candidates.length !== rawCandidates.length) {
      log.debug(
        { telegramId: ctx.from?.id, before: rawCandidates.length, after: candidates.length },
        "Buy-domains: removed duplicate domains from manual list",
      );
    }

    log.debug({ telegramId: ctx.from?.id, domains: candidates }, "Buy-domains: manual list accepted");
    return candidates;
  }
}

async function collectIpAndQueue(
  conversation: MyConversation,
  ctx: MyContext,
  domains: string[],
  aioUserUUID: string,
): Promise<void> {
  await ctx.reply("🌐 Введите IP-адрес сервера, на который будут добавлены домены:");

  let ip = "";
  while (true) {
    const current = await conversation.waitFor("message:text");
    const candidate = current.message.text.trim();
    if (!isValidIpv4(candidate)) {
      await current.reply("❌ Некорректный формат IPv4-адреса. Попробуйте снова:");
      continue;
    }
    ip = candidate;
    break;
  }

  const telegramId = ctx.from!.id;
  const chatId = ctx.chat!.id;
  log.debug({ telegramId, ip, domainCount: domains.length }, "Buy-domains: IP collected, queuing purchase jobs");

  let totalPrice = 0;
  for (const domain of domains) {
    const price = getDomainPrice(domain);
    totalPrice += price;
    const sent = await ctx.api.sendMessage(chatId, `🌐 Домен: ${domain}\n⏳ Задача поставлена в очередь...`);
    // Discard the BullMQ Job return value — conversation.external clones
    // whatever the callback returns via structuredClone, and a Job instance
    // isn't cloneable.
    await conversation.external(async () => {
      await enqueueDomainPurchase({
        domain,
        ip,
        telegramId,
        aioUserUUID,
        chatId,
        messageId: sent.message_id,
        price,
      });
    });
  }

  log.info(
    { category: "billing", telegramId, aioUserUUID, ip, domainCount: domains.length, totalPrice },
    "Queued domain-purchase jobs",
  );
  await ctx.reply(`✅ Поставлено в очередь задач: ${domains.length}. Статус будет обновляться в сообщениях выше.`);
}
