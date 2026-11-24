import type { ElementHandle, Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const OLD_CIRCLE_CENTER_X = 120;
const NEW_CIRCLE_CENTER_X = 200;

export async function openRepository(page: Page) {
  await page
    .getByRole('button', { name: 'Open repository', exact: true })
    .last()
    .click();
}

export async function openScenario(page: Page, path: string, theme?: Theme) {
  if (theme) await page.emulateMedia({ colorScheme: theme });
  await page.goto(path);
  await openRepository(page);
}

export async function selectChange(page: Page, fileName: string) {
  await page
    .getByRole('tree', { name: 'Changes', exact: true })
    .getByText(fileName, { exact: true })
    .click();
}

export function diffViewer(page: Page): Locator {
  return page.getByRole('region', { name: 'Diff viewer', exact: true });
}

export function elementOverflowsWidth(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

export async function boundingBoxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Expected element to have a bounding box');
  return box;
}

export async function requiredElementHandle(
  locator: Locator,
): Promise<ElementHandle<SVGElement | HTMLElement>> {
  const handle = await locator.elementHandle();
  expect(handle).not.toBeNull();
  if (!handle) throw new Error('Expected element handle to exist');
  return handle;
}

export async function mockImageBlobs(page: Page) {
  await page.route('http://gitblob.localhost/**', async (route) => {
    const isOld =
      new URL(route.request().url()).searchParams.get('side') === 'old';
    const fill = isOld ? '#0f7c86' : '#0072b2';
    const circleCenterX = isOld ? OLD_CIRCLE_CENTER_X : NEW_CIRCLE_CENTER_X;
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="30" y="30" width="260" height="120" rx="20" fill="${fill}"/><circle cx="${circleCenterX}" cy="90" r="40" fill="#e69f00"/></svg>`,
    });
  });
}
