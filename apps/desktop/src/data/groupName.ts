/** Playlists often number their categories ("2. News/Новости"); the number is ordering noise, not a name. */
export const cleanGroupName = (name: string) => name.replace(/^\s*\d+\s*[.)\-]\s*/, "").trim() || name;
