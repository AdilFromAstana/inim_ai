import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as serviceAccount from '../../inim-ai.json';

@Injectable()
export class FirebaseService {
    private db: admin.firestore.Firestore;
    private readonly logger = new Logger(FirebaseService.name);

    constructor() {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        });
        this.db = admin.firestore();
    }

    // Сохраняем чат
    async saveChat(userId: number, userMessage: string, botMessage: string) {
        const chatRef = this.db.collection('chats').doc(userId.toString());
        await chatRef.collection('messages').add({
            userMessage,
            botMessage,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // Сохраняем напоминание
    async saveReminder(userId: number, text: string, datetime: Date) {
        const docRef = this.db.collection('reminders').doc();
        const reminder = {
            id: docRef.id,
            userId,
            text,
            datetime: datetime.toISOString(),
            isSent: false,
        };
        await docRef.set(reminder);
        return reminder;
    }

    // Получаем все активные (неотправленные) напоминания
    async getPendingReminders() {
        const snapshot = await this.db
            .collection('reminders')
            .where('isSent', '==', false)
            .get();
        return snapshot.docs.map(doc => doc.data());
    }

    // Помечаем напоминание как отправленное
    async markReminderSent(reminderId: string) {
        await this.db.collection('reminders').doc(reminderId).update({ isSent: true });
    }
}
