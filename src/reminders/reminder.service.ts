import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as cron from 'node-cron';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reminder } from './reminder.entity';
import { Telegraf } from 'telegraf';

@Injectable()
export class ReminderService implements OnModuleInit {
    private readonly logger = new Logger(ReminderService.name);
    private bot: Telegraf;

    constructor(
        @InjectRepository(Reminder)
        private readonly reminderRepo: Repository<Reminder>,
    ) { }

    setBot(bot: Telegraf) {
        this.bot = bot;
    }

    async onModuleInit() {
        const reminders = await this.reminderRepo.find({ where: { isSent: false } });
        this.logger.log(`📦 Восстанавливаем ${reminders.length} активных напоминаний...`);

        for (const reminder of reminders) {
            this.scheduleReminder(reminder);
        }
    }

    async create(data: { userId: number; text: string; datetime: Date }) {
        const reminder = this.reminderRepo.create(data);
        await this.reminderRepo.save(reminder);

        this.logger.log(
            `💾 Напоминание сохранено: userId=${data.userId}, text="${data.text}", datetime=${data.datetime.toISOString()}`
        );

        this.scheduleReminder(reminder);
        return reminder;
    }

    private scheduleReminder(reminder: Reminder) {
        const { datetime, userId, text } = reminder;
        const date = new Date(datetime);
        const cronExp = this.getCronExpression(date);

        this.logger.log(`🕒 Планируем напоминание для ${userId}: "${text}" в ${date.toLocaleString()} (cron: ${cronExp})`);

        cron.schedule(cronExp, async () => {
            try {
                await this.bot.telegram.sendMessage(userId, `⏰ Напоминание: ${text}`);
                reminder.isSent = true;
                await this.reminderRepo.save(reminder);
                this.logger.log(`✅ Отправлено напоминание пользователю ${userId}: "${text}"`);
            } catch (e) {
                this.logger.error(`❌ Ошибка при отправке напоминания пользователю ${userId}:`, e);
            }
        });
    }

    private getCronExpression(date: Date): string {
        const minute = date.getMinutes();
        const hour = date.getHours();
        const day = date.getDate();
        const month = date.getMonth() + 1;
        return `${minute} ${hour} ${day} ${month} *`;
    }
}
