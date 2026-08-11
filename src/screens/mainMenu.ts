import type { RenderedScreen } from '../utils/safeEdit';
import { buildMainMenuKeyboard } from '../keyboards/mainMenu';
import type { UserRole } from '../models/User';

export function renderMainMenu(role: UserRole, hasAioUuid: boolean): RenderedScreen {
    const text = [
        '🏠 <b>Главное меню</b>',
        '',
        role === 'admin' ? 'Вы вошли как администратор.' : 'Вы вошли как баер.',
    ].join('\n');
    return { text, keyboard: buildMainMenuKeyboard(role, hasAioUuid) };
}
