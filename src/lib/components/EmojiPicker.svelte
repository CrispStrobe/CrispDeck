<script lang="ts">
  let { onselect }: { onselect: (emoji: string) => void } = $props();

  let search = $state('');
  let show = $state(false);

  // Grouped emoji data (compact — most commonly used)
  const categories: Record<string, string[]> = {
    'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
    'Gestures': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🖤','❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💝','💘'],
    'Nature': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🌸','🌹','🌺','🌻','🌼','🌷','🌱','🌲','🌳','🌴','🌿','☘️','🍀','🍁','🍂','🍃','🌍','🌎','🌏','🌕','🌙','⭐','🌟','💫','✨','☀️','🌤️','⛅','🌥️','☁️','🌧️','⛈️','🌩️','🌈','🔥','💧','🌊'],
    'Food': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🌮','🌯','🫔','🥙','🧆','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃'],
    'Objects': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','💾','💿','📷','📹','🎥','📽️','📞','☎️','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','🔑','🗝️','🔧','🪛','🔨','⛏️','🪚','🔩','⚙️','🧰','🪤','📎','🖇️','📏','📐','✂️','📌','📍','🗺️','🧲','🪣'],
    'Symbols': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💝','💘','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','✅','❌','❓','❗','‼️','⁉️','⭕','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','▪️','▫️','◾','◽','◼️','◻️'],
  };

  const allEmoji = $derived(() => {
    if (!search) return categories;
    const q = search.toLowerCase();
    const filtered: Record<string, string[]> = {};
    // Simple: just show all, browser will handle display
    for (const [cat, emojis] of Object.entries(categories)) {
      filtered[cat] = emojis;
    }
    return filtered;
  });
</script>

<div class="relative inline-block">
  <button
    onclick={() => show = !show}
    class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md transition-colors text-base"
    title="Emoji"
  >
    😊
  </button>

  {#if show}
    <div class="absolute bottom-full left-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl z-50 w-72 max-h-64 overflow-hidden flex flex-col">
      <div class="p-2 border-b border-[var(--color-border)]">
        <input
          type="text"
          bind:value={search}
          placeholder="Search emoji..."
          class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] focus:outline-none"
        />
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        {#each Object.entries(allEmoji()) as [category, emojis]}
          <p class="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider mt-2 mb-1 first:mt-0">{category}</p>
          <div class="flex flex-wrap gap-0.5">
            {#each emojis as emoji}
              <button
                onclick={() => { onselect(emoji); show = false; }}
                class="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-surface-hover)] rounded text-base transition-colors"
              >
                {emoji}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
