import { Composer, Context, Scenes, session, Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
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

const bot = new Telegraf<Scenes.WizardContext>(BOT_TOKEN);

// ПОлучение изображения
const imageStep = new Composer<Scenes.WizardContext>();
imageStep.on(message('photo'), async ctx => {
	const chatId = getChatId(ctx);
	ctx.reply('Загружаю фото...');

	const imageId = ctx.message.photo.at(-1)!.file_id;
	const imagePath = path.join(TEMP_DIR, `image_${chatId}.jpg`);
	const fileLink = await ctx.telegram.getFileLink(imageId);
	const res = await fetch(fileLink.href);
	fs.writeFileSync(imagePath, Buffer.from(await res.arrayBuffer()));

	UserStates.set(chatId, { imagePath });

	await ctx.reply('Фото получено ✅. Теперь отправь аудио 🎧');
	return ctx.wizard.next();
});

// Получение аудио
const audioStep = new Composer<Scenes.WizardContext>();
audioStep.on(message('audio'), async ctx => {
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
});

// Получение времени старта аудио
const startSecStep = new Composer<Scenes.WizardContext>();
startSecStep.on(message('text'), async ctx => {
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

	return ctx.wizard.next();
});

const coverTypeStep = new Composer<Scenes.WizardContext>();
coverTypeStep.on('callback_query', async ctx => {
	if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
		await ctx.reply('Пожалуйста, выбери вариант кнопкой');
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
});

const scene = new Scenes.WizardScene<Scenes.WizardContext>(
	'sceneId',
	async ctx => {
		await ctx.reply('Отправьте изображение...');
		return ctx.wizard.next();
	},
	imageStep, // шаг с фильтром
	// audioStep, // аналогично для аудио
	startSecStep, // для числа
	async ctx => {
		await ctx.reply(
			'Выбери вариант отображения обложки:',
			Markup.inlineKeyboard([
				Markup.button.callback('Стандартный', 'DEFAULT'),
				Markup.button.callback('Винил', 'VINYL'),
				Markup.button.callback('CD Диск', 'CD'),
			]),
		);

		return ctx.wizard.next();
	},
	coverTypeStep,
	async ctx => {
		const chatId = getChatId(ctx);
		const dataAsString = JSON.stringify(UserStates.get(chatId), null, 2);
		await ctx.reply('```\n' + dataAsString + '\n```', { parse_mode: 'MarkdownV2' });
		await ctx.reply('Конец выполнения');
		return ctx.scene.leave();
	},
);

// to compose all scenes you use Stage
const stage = new Scenes.Stage<Scenes.WizardContext>([scene]);

bot.use(session());
bot.use(stage.middleware());

// you can enter the scene only AFTER registering middlewares
// otherwise ctx.scene will be undefined
bot.command('enterScene', ctx => ctx.scene.enter('sceneId'));

const mainMenu = Markup.keyboard([['Начать', 'Отмена']])
	.resize()
	.oneTime(false); // клавиатура не пропадает после нажатия

bot.start(async ctx => {
	await ctx.reply('Меню:', mainMenu);
});

// Обновляем клавиатуру при сбросе сцены или завершении
bot.hears('Отмена', async ctx => {
	await ctx.reply('Процесс отменен ✅', mainMenu);
	return ctx.scene.leave();
});

bot.hears('Начать', ctx => ctx.scene.enter('sceneId'));

bot.launch().then(() => console.log('Bot started 🚀'));

function getChatId(ctx: Context): number {
	const chatId = ctx.chat?.id;

	if (!chatId) throw new Error('Ошибка получения ID чата.');

	return chatId;
}
