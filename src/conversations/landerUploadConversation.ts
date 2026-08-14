import { InlineKeyboard } from "grammy";
import type { MyContext, MyConversation } from "../types";
import { env } from "../config/env";
import { downloadTelegramFileToTemp, deleteTempFile } from "../utils/tmpStorage";
import { enqueueLanderUpload } from "../queues/landerUploadQueue";
import { isValidUuid, normalizeUuid } from "../utils/uuid";
import { logger } from "../config/logger";

export const LANDER_UPLOAD_CONVERSATION_NAME = "landerUploadConversation";

const log = logger.child({ module: "conversation:lander-upload" });

const ALLOWED_MIME_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);

interface CollectedFile {
  filePath: string;
  originalName: string;
}

function counterText(count: number): string {
  return `📦 Загружено архивов: ${count} / ${env.maxLanderFiles}`;
}

function counterKeyboard(count: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (count > 0) {
    keyboard.text("✅ Продолжить", "landerUpload:continue").row();
  }
  keyboard.text("❌ Отмена", "landerUpload:cancel");
  return keyboard;
}

async function cleanupCollected(files: CollectedFile[]): Promise<void> {
  await Promise.all(files.map((f) => deleteTempFile(f.filePath)));
}

/**
 * Admin-only: first collects a single AIO assignee UUID for the whole
 * session (every lander created from this session's archives is shared with
 * this user), then collects up to `env.maxLanderFiles` zip archives sent as
 * documents (not compressed media), validating format/size on each one, and
 * finally queues one lander-bulk-upload job per archive, carrying the same
 * assigneeUuid along. Archives are downloaded to disk as soon as they're
 * accepted (see src/utils/tmpStorage.ts) — file_ids alone aren't enough to
 * hand to a BullMQ job, and Telegram file links expire, so the download has
 * to happen up front rather than at job time.
 */
export async function landerUploadConversation(conversation: MyConversation, ctx: MyContext): Promise<void> {
  const adminTelegramId = ctx.from?.id;
  log.debug({ adminTelegramId }, "Started landerUploadConversation");

  await ctx.reply(
    "🔑 Введите AIO UUID пользователя, на которого нужно расшарить все вайты, загружаемые в этой сессии (assignee_uuid):",
  );

  let assigneeUuid = "";
  while (true) {
    const current = await conversation.waitFor("message:text");
    const text = current.message.text.trim();
    if (!isValidUuid(text)) {
      await current.reply("❌ Неверный формат UUID. Попробуйте снова:");
      continue;
    }
    assigneeUuid = normalizeUuid(text);
    break;
  }
  log.debug({ adminTelegramId, assigneeUuid }, "Assignee UUID collected for lander-upload session");

  await ctx.reply(
    "📤 Пришлите zip-архивы с вайтами <b>файлами</b> (документом, не как сжатое медиа).\n\n" +
      `Лимит: ${env.maxLanderFiles} архивов за раз, до ${env.maxLanderFileSizeMb} МБ каждый.`,
    { parse_mode: "HTML" },
  );

  const statusMessage = await ctx.reply(counterText(0), { reply_markup: counterKeyboard(0) });
  const collected: CollectedFile[] = [];

  try {
    while (true) {
      const current = await conversation.waitFor(["message:document", "callback_query:data"], {
        otherwise: async (skipped) => {
          await skipped.reply("Пришлите zip-архив файлом или нажмите кнопку ниже.").catch(() => {});
        },
      });

      if (current.callbackQuery) {
        await current.answerCallbackQuery().catch(() => {});
        const data = current.callbackQuery.data;

        if (data === "landerUpload:cancel") {
          log.info({ adminTelegramId, collected: collected.length }, "Lander upload cancelled");
          await cleanupCollected(collected);
          await ctx.reply("❌ Загрузка отменена.");
          return;
        }

        if (data === "landerUpload:continue") {
          if (collected.length === 0) continue; // button isn't shown at 0, but guard just in case
          break;
        }

        continue;
      }

      const document = current.message?.document;
      if (!document) continue;

      if (collected.length >= env.maxLanderFiles) {
        await current.reply(
          `❌ Достигнут лимит ${env.maxLanderFiles} архивов за раз. Нажмите «✅ Продолжить» или «❌ Отмена».`,
        );
        continue;
      }

      const name = document.file_name ?? "";
      const isZipExtension = name.toLowerCase().endsWith(".zip");
      const isZipMime = document.mime_type ? ALLOWED_MIME_TYPES.has(document.mime_type) : false;
      if (!isZipExtension && !isZipMime) {
        await current.reply(`❌ «${name || "файл"}» не похож на zip-архив. Пришлите файл в формате .zip.`);
        continue;
      }

      const maxBytes = env.maxLanderFileSizeMb * 1024 * 1024;
      if (document.file_size !== undefined && document.file_size > maxBytes) {
        await current.reply(
          `❌ «${name}» слишком большой (${(document.file_size / 1024 / 1024).toFixed(1)} МБ). ` +
            `Максимум ${env.maxLanderFileSizeMb} МБ.`,
        );
        continue;
      }

      let filePath: string;
      try {
        // current.getFile() is a Bot API call and must run outside
        // conversation.external() — the plugin docs explicitly forbid
        // starting a Bot API call from inside external(), since external()
        // callbacks bypass the replay engine entirely. Nesting one in here
        // silently corrupts replay state on the *next* loop iteration
        // (desyncs the op log), which is what made every archive after the
        // first one seem to vanish. Only the raw (non-Bot-API) download
        // itself — the actual disk I/O — belongs inside external().
        const file = await current.getFile();
        if (!file.file_path) throw new Error("Telegram did not return a file_path for the uploaded document");
        const telegramFilePath = file.file_path;
        filePath = await conversation.external(() => downloadTelegramFileToTemp(telegramFilePath, ".zip"));
      } catch (err) {
        log.error({ err, adminTelegramId, name }, "Failed to download an uploaded archive from Telegram");
        await current.reply(`❌ Не удалось скачать «${name}» — попробуйте прислать ещё раз.`);
        continue;
      }

      collected.push({ filePath, originalName: name || `archive${collected.length + 1}.zip` });
      log.debug({ adminTelegramId, name, count: collected.length }, "Accepted an archive for lander upload");

      await ctx.api
        .editMessageText(statusMessage.chat.id, statusMessage.message_id, counterText(collected.length), {
          reply_markup: counterKeyboard(collected.length),
        })
        .catch(() => {});
    }
  } catch (err) {
    // Any unexpected error mid-collection (e.g. a network hiccup downloading
    // a file) — clean up whatever was already downloaded instead of leaking
    // temp files, then let the error propagate to bot.catch().
    log.error({ err, adminTelegramId, collected: collected.length }, "landerUploadConversation failed mid-collection");
    await cleanupCollected(collected);
    throw err;
  }

  const chatId = ctx.chat!.id;
  log.info({ adminTelegramId, count: collected.length }, "Queuing lander-upload jobs");

  for (const file of collected) {
    const sent = await ctx.api.sendMessage(chatId, `📦 Файл: ${file.originalName}\n⏳ Задача поставлена в очередь...`);
    // Discard the BullMQ Job return value — conversation.external clones
    // whatever the callback returns via structuredClone, and a Job instance
    // isn't cloneable.
    await conversation.external(async () => {
      await enqueueLanderUpload({
        filePath: file.filePath,
        originalName: file.originalName,
        telegramId: adminTelegramId!,
        chatId,
        messageId: sent.message_id,
        assigneeUuid,
      });
    });
  }

  await ctx.reply(`✅ Поставлено в очередь архивов: ${collected.length}. Статус будет обновляться в сообщениях выше.`);
}
