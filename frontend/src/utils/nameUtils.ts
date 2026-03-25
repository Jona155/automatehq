export function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const [firstName] = fullName.trim().split(/\s+/);
  return firstName || fullName;
}
