const CATEGORY_PALETTE = [
  {
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    card: 'border-rose-200 dark:border-rose-800',
  },
  {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    card: 'border-amber-200 dark:border-amber-800',
  },
  {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    card: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    card: 'border-sky-200 dark:border-sky-800',
  },
  {
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    card: 'border-violet-200 dark:border-violet-800',
  },
  {
    badge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
    card: 'border-fuchsia-200 dark:border-fuchsia-800',
  },
  {
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    card: 'border-cyan-200 dark:border-cyan-800',
  },
  {
    badge: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
    card: 'border-lime-200 dark:border-lime-800',
  },
]

function hashCategoryName(name: string): number {
  return Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0)
}

export function getCategoryColorClasses(category: string | null | undefined) {
  if (!category) {
    return {
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      card: 'border-slate-200 dark:border-slate-700',
    }
  }

  return CATEGORY_PALETTE[hashCategoryName(category) % CATEGORY_PALETTE.length]
}