/**
 * Arabic strings. Partial: anything missing falls back to English.
 * Loaded on demand — see ../i18n.svelte.ts.
 */
const ar: Record<string, any> = {
  nav: {
    dashboard: 'لوحة التحكم', feed: 'الخلاصة', deck: 'الأعمدة', compose: 'كتابة', drafts: 'المسودات',
    notifications: 'الإشعارات', messages: 'الرسائل', bookmarks: 'الإشارات المرجعية',
    lists: 'القوائم', feedBuilder: 'منشئ التغذية', starterPacks: 'حزم البداية', identities: 'الهويات',
    search: 'بحث', trending: 'الرائج', archive: 'الأرشيف',
    labelers: 'المصنفات', instance: 'معلومات الخادم', moderation: 'الإشراف',
    analytics: 'التحليلات', settings: 'الإعدادات', post: 'نشر', alerts: 'تنبيهات', dms: 'رسائل',
  },
  app: { name: 'CrispDeck', subtitle: 'ماستودون + بلوسكاي', collapse: 'طي', expand: 'توسيع' },
  compose: {
    title: 'كتابة', placeholder: 'ما الذي يدور في ذهنك؟ اكتب @ للإشارة...',
    post: 'نشر', postThread: 'نشر سلسلة', posting: 'جاري النشر...',
    saveDraft: 'حفظ مسودة', draftSaved: 'تم حفظ المسودة',
    selectAccount: 'اختر حسابًا واحدًا على الأقل.', cw: 'تحذير محتوى',
  },
  feed: {
    title: 'الخلاصة', timeline: 'الجدول الزمني', myPosts: 'منشوراتي', all: 'الكل',
    noAccounts: 'لا توجد حسابات', addAccountsFirst: 'أضف حسابات في الإعدادات أولاً.',
    loadingTimeline: 'جاري تحميل الجدول الزمني...', loadingYourPosts: 'جاري تحميل منشوراتك...',
    loadingMore: 'جاري التحميل...', scrollMore: 'مرر لتحميل المزيد',
    endOfFeed: 'نهاية الخلاصة', noPostsMatch: 'لا توجد منشورات مطابقة', noPostsFound: 'لم يتم العثور على منشورات',
  },
  analytics: { title: 'التحليلات', loadPosts: 'تحميل المنشورات', loadHint: 'سيتم جلب جميع منشوراتك لحساب الإحصاءات.', loadAll: 'تحميل الكل' },
  messages: { title: 'الرسائل', noConversations: 'لا توجد محادثات', selectConversation: 'اختر محادثة', typePlaceholder: 'اكتب رسالة...' },
  drafts: { title: 'المسودات', noDrafts: 'لا توجد مسودات' },
  settings: { title: 'الإعدادات', language: 'اللغة', theme: 'المظهر' },
  profile: { follow: 'متابعة', unfollow: 'إلغاء المتابعة', mute: 'كتم', block: 'حظر', followers: 'المتابعون', following: 'المتابَعون' },
  archive: {
    title: 'الأرشيف', totalArchived: 'إجمالي الأرشيف', byPlatform: 'حسب المنصة',
    searchPlaceholder: 'بحث في الأرشيف...', allTypes: 'كل الأنواع',
    posts: 'منشورات', likes: 'إعجابات', reposts: 'إعادة نشر', replies: 'ردود',
    allPlatforms: 'كل المنصات', noArchive: 'لا يوجد أرشيف',
  },
  common: { dismiss: 'إغلاق', loading: 'جاري التحميل...', error: 'خطأ', postedTo: 'تم النشر على {platform}', view: 'عرض', bluesky: 'بلوسكاي', mastodon: 'ماستودون', threads: 'ثريدز' },
};

export default ar;
