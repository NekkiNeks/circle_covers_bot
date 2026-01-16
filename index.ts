import { Composer, Context, Scenes, session, Telegraf, Markup } from 'telegraf';
import path from 'node:path';
import fs from 'node:fs';

/* ===== Тип состояния сцены ===== */
interface WizardState {
	imagePath?: string;
	audioPath?: string;
	startSec?: number;
	choice?: 'DEFAULT' | 'VINYL' | 'CD';
}

const UserStates = new Map<number, WizardState>();

const TEMP_DIR = './temp';
const BOT_TOKEN = '8504277957:AAEgUjf1zjVmMmODe7hVSBM_sZ84aLOkcj0';

/* ===== Общий cancel ===== */
const cancelHandler = new Composer<Scenes.WizardContext>();
cancelHandler.command('cancel', async ctx => {
	await ctx.reply('❌ Сценарий отменён');

	// ДОбавить сюда остановку процесса.
	return ctx.scene.leave();
});

/* ===== Шаг 1 — изображение ===== */

// ---------------------------------------------

// specify generic type of Telegraf context
// thus Typescript will know that ctx.scene exists
const bot = new Telegraf<Scenes.WizardContext>(BOT_TOKEN);

// you can also pass step handlers as Composer
// and attach any methods you need
// const stepHandler = new Composer<Scenes.WizardContext>();

// stepHandler.command('next', async ctx => {
// 	await ctx.reply('Step 2. Via command');
// 	return ctx.wizard.next();
// });

const scene = new Scenes.WizardScene<Scenes.WizardContext>(
	'sceneId',
	async ctx => {
		await ctx.reply('Отправьте изображение...');
		return ctx.wizard.next();
	},

	// Шаг 1: ПОлучение изображения
	async ctx => {
		const chatId = getChatId(ctx);

		if (!ctx.message || !('photo' in ctx.message)) {
			// ❌ если это не фото
			await ctx.reply('Пожалуйста, отправьте именно изображение.');
			return;
		}

		ctx.reply('Загружаю изображение на сервер...');

		// берём самое большое изображение
		const imageId = ctx.message.photo.at(-1)!.file_id;
		const imagePath = path.join(TEMP_DIR, `image_${chatId}.jpg`);
		const fileLink = await ctx.telegram.getFileLink(imageId);
		const res = await fetch(fileLink.href);
		fs.writeFileSync(imagePath, Buffer.from(await res.arrayBuffer()));

		UserStates.set(chatId, { imagePath });

		await ctx.reply('Изображение получено ✅. Теперь отправь аудио 🎧');

		ctx.wizard.next();
	},

	// Шаг 2: Получение аудио
	async ctx => {
		if (!ctx.message || !('audio' in ctx.message)) {
			await ctx.reply('Пожалуйста, отправьте именно аудио.');
			return;
		}

		const chatId = getChatId(ctx);

		const fileId = ctx.message.audio.file_id;

		await ctx.reply('Загружаю аудио...');
		const audioPath = path.join(TEMP_DIR, `track_${chatId}.mp3`);
		const fileLink = await ctx.telegram.getFileLink(fileId);
		const res = await fetch(fileLink.href);
		fs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()));

		// TODO: Вынести в отдельный метод
		const userState = UserStates.get(chatId);
		if (!userState) throw new Error('Ошибка получения загруженных данных');
		userState.audioPath = audioPath;
		UserStates.set(chatId, userState);

		await ctx.reply('Аудио получено ✅. Теперь отправь время старта в секундах (например: 15) ⏱️');

		return ctx.wizard.next();
	},

	// Шаг 3: Получение времени начала аудиодорожки
	async ctx => {
		if (!ctx.message || !('text' in ctx.message)) {
			await ctx.reply('Пожалуйста, отправьте число.');
			return;
		}

		const chatId = getChatId(ctx);

		const startSec = parseInt(ctx.message.text, 10);
		if (isNaN(startSec) || startSec < 0) {
			await ctx.reply('Пожалуйста, отправь корректное число секунд (0 и больше).');
			return;
		}

		// TODO: Вынести в отдельный метод
		const userState = UserStates.get(chatId);
		if (!userState) throw new Error('Ошибка получения загруженных данных');
		userState.startSec = startSec;
		UserStates.set(chatId, userState);

		ctx.wizard.next();
	},

	// Шаг 5: Отображение вариантов обложки
	async ctx => {
		await ctx.reply(
			'Выбери вариант отображения обложки:',
			Markup.inlineKeyboard([
				Markup.button.callback('Стандартный', 'DEFAULT'),
				Markup.button.callback('Винил', 'VINYL'),
				Markup.button.callback('CD Диск', 'CD'),
			]),
		);

		ctx.wizard.next();
	},

	// Шаг 6: ПОлучение варианта обложки
	async ctx => {
		if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
			await ctx.reply('Пожалуйста, выбери вариант кнопкой ⬇️');
			return;
		}

		const selectedCoverType = ctx.callbackQuery.data as 'DEFAULT' | 'VINYL' | 'CD';

		const chatId = getChatId(ctx);

		const userState = UserStates.get(chatId);
		if (!userState) throw new Error('Ошибка получения данных пользователя');

		userState.choice = selectedCoverType;
		UserStates.set(chatId, userState);

		await ctx.answerCbQuery('Выбор принят...');
		await ctx.reply(`Выбран тип обложки: \`${selectedCoverType}\` ✅`, { parse_mode: 'MarkdownV2' });

		return ctx.wizard.next();
	},

	// Шаг 7: Отображение выбора пользователя: (Тестовый режим)
	async ctx => {
		const chatId = getChatId(ctx);

		const dataAsString = JSON.stringify(UserStates.get(chatId), null, 2);

		ctx.reply('```\n' + dataAsString + '\n```', { parse_mode: 'MarkdownV2' });
	},

	async ctx => {
		await ctx.reply('Done');
		return await ctx.scene.leave();
	},
);

// to compose all scenes you use Stage
const stage = new Scenes.Stage<Scenes.WizardContext>([scene]);

bot.use(session());
// this attaches ctx.scene to the global context
bot.use(stage.middleware());

// you can enter the scene only AFTER registering middlewares
// otherwise ctx.scene will be undefined
bot.command('enterScene', ctx => ctx.scene.enter('sceneId'));

bot.launch();

function getChatId(ctx: Context): number {
	const chatId = ctx.chat?.id;

	if (!chatId) throw new Error('Ошибка получения ID чата.');

	return chatId;
}
