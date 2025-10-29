import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { FirebaseService } from 'src/firebase/firebase.service';
import moment from 'moment-timezone';

interface Reminder {
    id: string;
    userId: number;
    text: string;
    datetime: Date;
    isSent: boolean;
}

@Injectable()
export class ReminderService implements OnModuleInit {
    private readonly logger = new Logger(ReminderService.name);
    private bot: Telegraf;
    private readonly userTz = 'Asia/Almaty';

    constructor(private readonly firebase: FirebaseService) { }

    setBot(bot: Telegraf) {
        this.bot = bot;
    }

    async onModuleInit() {
        const rawReminders = await this.firebase.getPendingReminders();
        const reminders: Reminder[] = rawReminders.map((r: any) => {
            const utcDate = moment.utc(r.datetime).toDate(); // просто UTC
            return { ...r, datetime: utcDate };
        });

        this.logger.log(`📦 Восстанавливаем ${reminders.length} активных напоминаний...`);

        for (const reminder of reminders) {
            this.scheduleReminder(reminder);
        }
    }

    async create(data: { userId: number; text: string; datetime: Date }) {
        const savedRaw = await this.firebase.saveReminder(data.userId, data.text, data.datetime);

        const saved: Reminder = {
            ...savedRaw,
            datetime: moment.utc(savedRaw.datetime).tz(this.userTz).toDate(),
        };

        this.logger.log(
            `💾 Напоминание сохранено: userId=${data.userId}, text="${data.text}", datetime=${saved.datetime.toISOString()}`
        );

        this.scheduleReminder(saved);
        return saved;
    }

    private scheduleReminder(reminder: Reminder) {
        const { userId, text, datetime, id } = reminder;
        const delay = datetime.getTime() - Date.now();
        if (delay <= 0) return;

        setTimeout(async () => {
            try {
                await this.bot.telegram.sendMessage(userId, `⏰ Напоминание: ${text}`);
                await this.firebase.markReminderSent(id);
                this.logger.log(`✅ Отправлено напоминание пользователю ${userId}: "${text}"`);
            } catch (e) {
                this.logger.error(`❌ Ошибка при отправке напоминания пользователю ${userId}:`, e);
            }
        }, delay);
    }
}
