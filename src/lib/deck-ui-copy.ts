import type { Language } from './i18n.svelte';
const labels: Record<Language, { scrollOff: string; scrollOn: string; pin: string; unpin: string }> = {
 en: { scrollOff: 'Auto-scroll off (click to enable)', scrollOn: 'Auto-scroll on (click to lock)', pin: 'Pin column', unpin: 'Unpin column' },
 de: { scrollOff: 'Automatisches Scrollen aus (zum Einschalten klicken)', scrollOn: 'Automatisches Scrollen an (zum Sperren klicken)', pin: 'Spalte anheften', unpin: 'Spalte lösen' },
 fr: { scrollOff: 'Défilement automatique désactivé (activer)', scrollOn: 'Défilement automatique activé (verrouiller)', pin: 'Épingler la colonne', unpin: 'Désépingler la colonne' },
 es: { scrollOff: 'Desplazamiento automático desactivado (activar)', scrollOn: 'Desplazamiento automático activado (bloquear)', pin: 'Fijar columna', unpin: 'Desfijar columna' },
 pt: { scrollOff: 'Deslocamento automático desativado (ativar)', scrollOn: 'Deslocamento automático ativado (bloquear)', pin: 'Fixar coluna', unpin: 'Desafixar coluna' },
 ja: { scrollOff: '自動スクロールオフ（有効にする）', scrollOn: '自動スクロールオン（固定する）', pin: '列を固定', unpin: '列の固定を解除' },
 zh: { scrollOff: '自动滚动已关闭（点击开启）', scrollOn: '自动滚动已开启（点击锁定）', pin: '固定栏目', unpin: '取消固定栏目' },
 ar: { scrollOff: 'التمرير التلقائي متوقف (اضغط للتفعيل)', scrollOn: 'التمرير التلقائي يعمل (اضغط للقفل)', pin: 'تثبيت العمود', unpin: 'إلغاء تثبيت العمود' },
};
export const deckUi = (language: Language) => labels[language];
