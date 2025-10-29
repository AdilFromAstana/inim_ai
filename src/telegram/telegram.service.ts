import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { ReminderService } from '../reminders/reminder.service';
import { ConfigService } from '@nestjs/config';
import moment from 'moment-timezone';
import { FirebaseService } from 'src/firebase/firebase.service';

@Injectable()
export class TelegramService implements OnModuleInit {
    private readonly logger = new Logger(TelegramService.name);
    private bot: Telegraf;
    private readonly GEMINI_URL =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    private readonly userTz = 'Asia/Almaty';

    constructor(
        private readonly reminders: ReminderService,
        private readonly config: ConfigService,
        private readonly firebase: FirebaseService
    ) { }

    async onModuleInit() {
        const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
        const apiKey = this.config.get<string>('GEMINI_API_KEY');

        if (!token) throw new Error('TELEGRAM_BOT_TOKEN не задан');
        if (!apiKey) throw new Error('GEMINI_API_KEY не задан');

        this.bot = new Telegraf(token);
        this.reminders.setBot(this.bot);

        const userReplies = new Map<number, { lastPrompt: string; active: boolean }>();

        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text.trim();
            const user = ctx.message.from;
            const username = user.username || user.first_name;
            const now = new Date().toISOString();

            this.logger.log(`💬 [${username}] написал: "${text}"`);

            const waiting = userReplies.get(user.id);
            if (waiting?.active) {
                userReplies.set(user.id, { ...waiting, active: false });
                await ctx.reply('✅ Отлично! Будем считать задачу выполненной.');
                return;
            }

            const prompt = `
Ты — Telegram-ассистент, который создает напоминания пользователям из разных стран.

⚙️ Формат ответа — строго JSON:
{
  "action": "reminder" | "chat",
  "message": "короткий понятный ответ пользователю, где ты явно указываешь локальное время напоминания",
  "reminder"?: {
    "text": "что напомнить",
    "datetime": "ISO-время в UTC, которое соответствует локальному времени пользователя"
  }
}

Текущее время (UTC): ${now}.
Пользователь написал: "${text}".

⚠️ Важное:
- Локальная часовая зона пользователя: Asia/Almaty (UTC+5).  
- В поле "datetime" верни **ISO-время в UTC**, которое соответствует локальному времени пользователя.  
  Например, если пользователь написал "в 8 утра", верни UTC-время, которое соответствует 08:00 по Asia/Almaty.
- Не меняй текст сообщения, просто дай корректное UTC-время.
- Никогда не смещай UTC ещё раз на локальную зону — это должно быть чистое UTC-время для сохранения.

Ответ строго в JSON.
`;

            try {
                const response = await fetch(this.GEMINI_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
                    const jsonStart = rawReply.indexOf('{');
                    if (jsonStart === -1) {
                        await ctx.reply('⚠️ AI ответил в неправильном формате, попробуй иначе.');
                        return;
                    }
                    parsed = JSON.parse(rawReply.slice(jsonStart));
                } catch {
                    this.logger.warn(`⚠️ Gemini вернул невалидный JSON: ${rawReply}`);
                    await ctx.reply('⚠️ AI ответил в неправильном формате, попробуй иначе.');
                    return;
                }

                this.logger.log(`🤖 Ответ Gemini: ${JSON.stringify(parsed)}`);

                if (parsed.action === 'reminder' && parsed.reminder?.datetime) {
                    // 1. Сохраняем UTC напрямую
                    const utcDate = moment.utc(parsed.reminder.datetime).toDate();

                    await this.reminders.create({
                        userId: user.id,
                        text: parsed.reminder.text,
                        datetime: utcDate, // сохраняем UTC
                    });

                    // 2. Конвертируем только для ответа пользователю
                    const localTime = moment(utcDate)
                        .tz(this.userTz)
                        .format('HH:mm, D MMMM');

                    await ctx.reply(
                        `✅ Окей! Я напомню тебе "${parsed.reminder.text}" в ${localTime} по твоему времени.`
                    );
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
