import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { ReminderService } from '../reminders/reminder.service';
import { ConfigService } from '@nestjs/config';
import moment from 'moment-timezone';

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private bot: Telegraf;
    private readonly GEMINI_URL =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    constructor(
        private readonly reminders: ReminderService,
        private readonly config: ConfigService,
    ) { }

    async onModuleInit() {
        const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
        const apiKey = this.config.get<string>('GEMINI_API_KEY');

        if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан');
        if (!apiKey) throw new Error('GEMINI_API_KEY не задан');

        this.bot = new Telegraf(token);
        this.reminders.setBot(this.bot);

        // 🧠 Отслеживаем ответы после напоминаний
        const userReplies = new Map<number, { lastPrompt: string; active: boolean }>();

        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text.trim();
            const user = ctx.message.from;
            const username = user.username || user.first_name;
            const now = new Date().toISOString();

            this.logger.log(`💬 [${username}] написал: "${text}"`);

            // Если бот ранее ждал ответ от пользователя — считаем задачу закрытой
            const waiting = userReplies.get(user.id);
            if (waiting?.active) {
                userReplies.set(user.id, { ...waiting, active: false });
                await ctx.reply('✅ Отлично! Будем считать задачу выполненной.');
                return;
            }

            const userTz = 'Asia/Almaty';

            const prompt = `
Ты — Telegram-ассистент, который создает напоминания пользователям из разных стран.

⚙️ Формат ответа — строго JSON:
{
  "action": "reminder" | "chat",
  "message": "короткий понятный ответ пользователю, где ты явно указываешь локальное время напоминания",
  "reminder"?: {
    "text": "что напомнить",
    "datetime": "ISO-время (UTC или с таймзоной)"
  }
}

📘 Пример:
Пользователь: "напомни через 10 минут выпить воду"
Ответ:
{
  "action": "reminder",
  "message": "Окей! Я напомню тебе выпить воду в 03:25 по твоему времени.",
  "reminder": {
    "text": "выпить воду",
    "datetime": "2025-10-30T03:25:00+05:00"
  }
}

Текущее время (UTC): ${now}.
Пользователь написал: "${text}".
Определи дату и время напоминания точно и корректно.
`;

            try {
                const response = await fetch(this.GEMINI_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey,
                    },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.5, topP: 0.9, maxOutputTokens: 300 },
                    }),
                });

                const data = await response.json();

                if (data.error) {
                    this.logger.error(`❌ Gemini API error: ${data.error.message}`);
                    await ctx.reply('⚠️ Ошибка при обращении к AI. Попробуй позже.');
                    return;
                }

                let rawReply = data?.candidates?.[0]?.content?.parts
                    ?.map((p) => p.text)
                    .join(' ')
                    ?.trim();

                if (!rawReply) {
                    await ctx.reply('🤔 Не понял, повтори иначе.');
                    return;
                }

                rawReply = rawReply.replace(/```json|```/g, '').trim();

                let parsed: any;
                try {
                    parsed = JSON.parse(rawReply);
                } catch {
                    this.logger.warn(`⚠️ Gemini вернул невалидный JSON: ${rawReply}`);
                    await ctx.reply('⚠️ AI ответил в неправильном формате, попробуй иначе.');
                    return;
                }

                this.logger.log(`🤖 Ответ Gemini: ${JSON.stringify(parsed)}`);

                if (parsed.action === 'reminder' && parsed.reminder?.datetime) {
                    const reminderDate = new Date(parsed.reminder.datetime);

                    if (isNaN(reminderDate.getTime())) {
                        this.logger.warn(`⚠️ Некорректная дата: ${parsed.reminder.datetime}`);
                        await ctx.reply('⚠️ Не понял, когда именно напомнить. Укажи точнее.');
                        return;
                    }

                    await this.reminders.create({
                        userId: user.id,
                        text: parsed.reminder.text,
                        datetime: reminderDate,
                    });

                    const localTime = moment(reminderDate)
                        .tz(userTz)
                        .format('HH:mm, D MMMM');

                    this.logger.log(
                        `✅ Напоминание "${parsed.reminder.text}" на ${reminderDate.toISOString()}`,
                    );

                    await ctx.reply(
                        `✅ Окей! Я напомню тебе "${parsed.reminder.text}" в ${localTime} по твоему времени.`,
                    );

                    // ⚙️ Когда наступит время напоминания
                    const delay = reminderDate.getTime() - Date.now();
                    if (delay > 0) {
                        setTimeout(async () => {
                            await ctx.reply(`⏰ Напоминаю: ${parsed.reminder.text}. Ну что, как там дела?`);
                            userReplies.set(user.id, { lastPrompt: parsed.reminder.text, active: true });

                            const followUps = [
                                { delay: 7 * 60 * 1000, text: 'Слушай, а как там, всё сделал?' },
                                { delay: 25 * 60 * 1000, text: 'Кажется, тишина... надеюсь, всё в порядке?' },
                                {
                                    delay: 60 * 60 * 1000,
                                    text: 'Ладно, будем считать задачу выполненной ☑️ (ответа не получил)',
                                },
                            ];

                            for (const follow of followUps) {
                                setTimeout(async () => {
                                    const state = userReplies.get(user.id);
                                    if (!state?.active) return; // если ответил — не напоминаем
                                    await ctx.reply(follow.text);
                                    if (follow.text.includes('☑️')) {
                                        userReplies.set(user.id, { ...state, active: false });
                                    }
                                }, follow.delay);
                            }
                        }, delay);
                    }
                    return;
                }

                await ctx.reply(parsed.message || 'Окей 👍');
            } catch (err) {
                this.logger.error(`🔥 Ошибка при обработке: ${err.message}`, err.stack);
                await ctx.reply('⚠️ Возникла ошибка, попробуй позже.');
            }
        });

        await this.bot.launch();
        this.logger.log('🚀 Telegram бот запущен и готов к работе.');
    }
}
