import type { Language } from '$lib/i18n.svelte';

const en = {
  title: 'AI assistance in this draft',
  hint: 'Review the text and image descriptions. These records stay with drafts and templates; social networks do not receive them.',
  generated: 'AI-generated portion', assisted: 'AI-assisted edit', modified: 'edited since generation',
  review: 'I reviewed these contributions', reviewed: 'Reviewed',
  export: 'Export text + AI record (JSON)', copy: 'Copy text with disclosure', add: 'Add disclosure to post',
  assistedText: 'Text prepared with AI assistance in CrispDeck.',
  generatedHashtags: 'Includes AI-generated hashtags from CrispDeck.',
  noImage: 'Attach an image without an existing description to generate alt text.',
  changed: 'The draft or image changed while AI was working. The response was not applied.',
  copyFailed: 'Could not copy. Use the JSON export instead.',
  limits: 'Application records are not a watermark or signed credentials. Text selection and destination overrides may omit this information. Check each destination before publishing.',
};
type Copy = typeof en;
const copies: Record<Language, Copy> = {
  en,
  de: {
    title: 'KI-Unterstützung in diesem Entwurf', hint: 'Text und Bildbeschreibungen prüfen. Diese Angaben bleiben in Entwürfen und Vorlagen; soziale Netzwerke erhalten sie nicht.',
    generated: 'KI-generierter Anteil', assisted: 'KI-unterstützte Bearbeitung', modified: 'seit der Generierung bearbeitet', review: 'Ich habe diese Beiträge geprüft', reviewed: 'Geprüft',
    export: 'Text + KI-Angaben exportieren (JSON)', copy: 'Text mit Kennzeichnung kopieren', add: 'Kennzeichnung zum Beitrag hinzufügen',
    assistedText: 'Text mit KI-Unterstützung in CrispDeck erstellt.', generatedHashtags: 'Enthält KI-generierte Hashtags aus CrispDeck.',
    noImage: 'Für einen Alternativtext ein Bild ohne vorhandene Beschreibung anhängen.', changed: 'Entwurf oder Bild wurde während der KI-Anfrage geändert. Die Antwort wurde nicht übernommen.',
    copyFailed: 'Kopieren fehlgeschlagen. Stattdessen den JSON-Export verwenden.', limits: 'Diese Angaben sind kein Wasserzeichen und keine signierten Nachweise. Beim Markieren von Text und bei abweichenden Zieltexten können sie fehlen. Jedes Ziel vor dem Veröffentlichen prüfen.',
  },
  fr: {
    title: 'Assistance IA dans ce brouillon', hint: 'Vérifiez le texte et les descriptions des images. Ces données restent dans les brouillons et modèles ; elles ne sont pas transmises aux réseaux sociaux.',
    generated: 'Partie générée par IA', assisted: 'Modification assistée par IA', modified: 'modifié depuis la génération', review: 'J’ai vérifié ces contributions', reviewed: 'Vérifié',
    export: 'Exporter le texte et les données IA (JSON)', copy: 'Copier le texte avec la mention', add: 'Ajouter la mention à la publication',
    assistedText: 'Texte préparé avec une assistance IA dans CrispDeck.', generatedHashtags: 'Contient des hashtags générés par IA dans CrispDeck.',
    noImage: 'Joignez une image sans description pour générer un texte alternatif.', changed: 'Le brouillon ou l’image a changé pendant la requête IA. La réponse n’a pas été appliquée.',
    copyFailed: 'Copie impossible. Utilisez l’export JSON.', limits: 'Ces données ne sont ni un filigrane ni une preuve signée. La sélection de texte et les variantes par destination peuvent les omettre. Vérifiez chaque destination avant publication.',
  },
  es: {
    title: 'Asistencia de IA en este borrador', hint: 'Revisa el texto y las descripciones de imágenes. Estos datos se conservan en borradores y plantillas; no se envían a las redes sociales.',
    generated: 'Parte generada por IA', assisted: 'Edición asistida por IA', modified: 'editado tras la generación', review: 'He revisado estas contribuciones', reviewed: 'Revisado',
    export: 'Exportar texto y datos de IA (JSON)', copy: 'Copiar texto con aviso', add: 'Añadir aviso a la publicación',
    assistedText: 'Texto preparado con asistencia de IA en CrispDeck.', generatedHashtags: 'Incluye hashtags generados por IA en CrispDeck.',
    noImage: 'Adjunta una imagen sin descripción para generar texto alternativo.', changed: 'El borrador o la imagen cambió durante la solicitud de IA. La respuesta no se aplicó.',
    copyFailed: 'No se pudo copiar. Usa la exportación JSON.', limits: 'Estos datos no son una marca de agua ni credenciales firmadas. La selección de texto y las variantes por destino pueden omitirlos. Revisa cada destino antes de publicar.',
  },
  pt: {
    title: 'Assistência de IA neste rascunho', hint: 'Revise o texto e as descrições das imagens. Estes dados ficam nos rascunhos e modelos; não são enviados às redes sociais.',
    generated: 'Parte gerada por IA', assisted: 'Edição assistida por IA', modified: 'editado após a geração', review: 'Revisei estas contribuições', reviewed: 'Revisado',
    export: 'Exportar texto e dados de IA (JSON)', copy: 'Copiar texto com aviso', add: 'Adicionar aviso à publicação',
    assistedText: 'Texto preparado com assistência de IA no CrispDeck.', generatedHashtags: 'Inclui hashtags geradas por IA no CrispDeck.',
    noImage: 'Anexe uma imagem sem descrição para gerar texto alternativo.', changed: 'O rascunho ou a imagem mudou durante a solicitação de IA. A resposta não foi aplicada.',
    copyFailed: 'Não foi possível copiar. Use a exportação JSON.', limits: 'Estes dados não são marca de água nem credenciais assinadas. A seleção de texto e as variantes por destino podem omiti-los. Verifique cada destino antes de publicar.',
  },
  ja: {
    title: 'この下書きのAI支援', hint: '本文と画像の説明を確認してください。この記録は下書きとテンプレートに保存され、SNSには送信されません。',
    generated: 'AIが生成した部分', assisted: 'AI支援による編集', modified: '生成後に編集済み', review: 'これらの内容を確認しました', reviewed: '確認済み',
    export: '本文とAI記録を出力（JSON）', copy: 'AI使用の表示を付けてコピー', add: '投稿にAI使用の表示を追加',
    assistedText: 'CrispDeckでAIの支援を受けて作成した本文です。', generatedHashtags: 'CrispDeckでAIが生成したハッシュタグを含みます。',
    noImage: '代替テキストを生成するには、説明のない画像を添付してください。', changed: 'AIの処理中に下書きまたは画像が変更されたため、回答は適用されませんでした。',
    copyFailed: 'コピーできませんでした。JSON出力を使用してください。', limits: 'この記録は透かしや署名付き証明ではありません。選択したテキストのコピーや投稿先別の本文には情報が含まれない場合があります。公開前に各投稿先を確認してください。',
  },
  zh: {
    title: '此草稿中的 AI 辅助', hint: '请检查正文和图片描述。这些记录保留在草稿和模板中，不会发送到社交网络。',
    generated: 'AI 生成的部分', assisted: 'AI 辅助编辑', modified: '生成后已编辑', review: '我已检查这些内容', reviewed: '已检查',
    export: '导出正文和 AI 记录（JSON）', copy: '复制正文并附 AI 使用说明', add: '将 AI 使用说明添加到帖子',
    assistedText: '本文在 CrispDeck 中借助 AI 编写。', generatedHashtags: '包含由 CrispDeck 中的 AI 生成的话题标签。',
    noImage: '请附加尚无描述的图片以生成替代文本。', changed: 'AI 处理期间草稿或图片已更改，未应用该回复。',
    copyFailed: '无法复制，请使用 JSON 导出。', limits: '这些记录不是水印或签名凭证。选中文本复制及针对不同平台修改的正文可能不含这些信息。发布前请检查每个发布目标。',
  },
  ar: {
    title: 'مساعدة الذكاء الاصطناعي في هذه المسودة', hint: 'راجع النص وأوصاف الصور. تُحفظ هذه السجلات مع المسودات والقوالب ولا تُرسل إلى الشبكات الاجتماعية.',
    generated: 'جزء مولّد بالذكاء الاصطناعي', assisted: 'تحرير بمساعدة الذكاء الاصطناعي', modified: 'عُدّل بعد التوليد', review: 'راجعت هذه المساهمات', reviewed: 'تمت المراجعة',
    export: 'تصدير النص وسجل الذكاء الاصطناعي (JSON)', copy: 'نسخ النص مع الإفصاح', add: 'إضافة الإفصاح إلى المنشور',
    assistedText: 'أُعدّ النص بمساعدة الذكاء الاصطناعي في CrispDeck.', generatedHashtags: 'يتضمن وسومًا مولّدة بالذكاء الاصطناعي في CrispDeck.',
    noImage: 'أرفق صورة بلا وصف لإنشاء نص بديل.', changed: 'تغيّرت المسودة أو الصورة أثناء معالجة الذكاء الاصطناعي. لم تُطبّق الإجابة.',
    copyFailed: 'تعذّر النسخ. استخدم تصدير JSON.', limits: 'هذه السجلات ليست علامة مائية أو بيانات اعتماد موقّعة. قد لا تُرفق عند تحديد النص أو تخصيصه لوجهة معينة. راجع كل وجهة قبل النشر.',
  },
};
export const aiProvenanceCopy = (language: Language): Copy => copies[language];
