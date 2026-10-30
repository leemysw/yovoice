/** 文件名的扩展名（小写、不含点），没有扩展名时为空串。 */
export const fileExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
