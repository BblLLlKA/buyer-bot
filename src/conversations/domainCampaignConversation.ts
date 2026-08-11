import type { MyContext, MyConversation } from "../types";
import { enqueueDomainCampaignLink } from "../queues/domainCampaignQueue";

export const DOMAIN_CAMPAIGN_CONVERSATION_NAME = "domainCampaignConversation";

const MAX_DOMAIN_RETRIES = 5;

function parseList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Collects a list of campaign IDs and an equal-length list of domains, pairs
 * them up by index, and queues one BullMQ job per pair — each job gets its
 * own progress message that the worker edits step by step.
 *
 * `aioUserUUID` is passed in by the caller (menuLinkDomainsHandler) rather
 * than read from `ctx.auth` here: entering a conversation only carries
 * `update`/`api`/`me` from the outer ctx, so custom properties like
 * `ctx.auth` aren't available inside.
 */
export async function domainCampaignConversation(
  conversation: MyConversation,
  ctx: MyContext,
  aioUserUUID: string,
): Promise<void> {
  await ctx.reply("Введите ID кампаний — каждый с новой строки или через запятую:");
  const campaignsCtx = await conversation.waitFor("message:text");
  const campaignIds = parseList(campaignsCtx.message.text);

  if (campaignIds.length === 0) {
    await campaignsCtx.reply("Не удалось распознать ни одного ID кампании. Начните заново из главного меню.");
    return;
  }

  let domains: string[] = [];
  let attempts = 0;
  while (true) {
    await ctx.reply(
      `Введите ${campaignIds.length} домен(ов) в том же порядке, каждый с новой строки или через запятую:`,
    );
    const domainsCtx = await conversation.waitFor("message:text");
    domains = parseList(domainsCtx.message.text);

    if (domains.length === campaignIds.length) break;

    attempts += 1;
    if (attempts >= MAX_DOMAIN_RETRIES) {
      await domainsCtx.reply("Слишком много неудачных попыток. Операция отменена, начните заново из главного меню.");
      return;
    }
    await domainsCtx.reply(
      `Количество доменов (${domains.length}) не совпадает с количеством кампаний (${campaignIds.length}). Попробуйте снова.`,
    );
  }

  const pairs = campaignIds.map((campaignId, i) => ({ campaignId, domain: domains[i] }));
  const chatId = ctx.chat!.id;

  for (const pair of pairs) {
    const sent = await ctx.api.sendMessage(
      chatId,
      `🔗 Кампания: ${pair.campaignId} → Домен: ${pair.domain}\n⏳ Задача поставлена в очередь...`,
    );
    // Discard the BullMQ Job return value — conversation.external clones
    // whatever the callback returns via structuredClone, and a Job instance
    // (like a Mongoose document) isn't cloneable.
    await conversation.external(async () => {
      await enqueueDomainCampaignLink({
        campaignId: pair.campaignId,
        domain: pair.domain,
        aioUserUUID,
        chatId,
        messageId: sent.message_id,
      });
    });
  }

  await ctx.reply(`Поставлено в очередь задач: ${pairs.length}. Статус будет обновляться в сообщениях выше.`);
}
