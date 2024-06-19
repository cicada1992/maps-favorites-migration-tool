import { FavoriteFolder } from '../types/favorite/favorite-folder.type';
import { FailedFavoriteItem, FavoriteItem } from '../types/favorite/favorite-item.type';
import { ContentWindow } from '../types/window/content-window.type';
import { Context } from '../types/window/context.type';
import { AbstractDriver } from './abstract.driver';
import { usleep } from '../utils/timer';

export class GoogleMapDriver extends AbstractDriver {
  private static readonly entryURL = 'https://www.google.com/maps/@/data=!4m2!10m1!1e1?entry=ttu';

  public label(): string {
    return '구글맵';
  }

  public async import(contentWindow: ContentWindow): Promise<FavoriteFolder[]> {
    let proc: ((e: unknown) => void) | null = null;
    return new Promise<FavoriteFolder[]>((resolve, reject) => {
      proc = async () => {
        await contentWindow.waitForPreload();
        await usleep(2000);
        const { webContents } = contentWindow.view;
        try {
          await this.checkLogin(webContents);
          await contentWindow.showLoading();
          const result: FavoriteFolder[] = [];
          const folders = await this.getFolders(webContents);
          for (const folder of folders) {
            const items = await this.getItemsBelongToFolder(webContents, folder.id);
            if (items.length) result.push({ name: folder.name, items })
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };

      contentWindow.view.webContents.on('dom-ready', proc).loadURL(GoogleMapDriver.entryURL);
    }).finally(async () => {
      await contentWindow.hideLoading();
      if (proc) contentWindow.view.webContents.off('dom-ready', proc);
    });
  }

  public export(contentWindow: ContentWindow, context: Context, from: FavoriteFolder[]): Promise<FavoriteFolder[]> {
    throw new Error('Method not implemented.');
  }

  public view(contentWindow: ContentWindow, item: FailedFavoriteItem<any>): void {
    throw new Error('Method not implemented.');
  }

  private async checkLogin(webContents: Electron.WebContents): Promise<void> {
    const isLogin = await webContents.executeJavaScript(
      //language=js
      `Boolean(document.querySelector('img.gb_p'))`,
    );
    if (!isLogin) throw new Error('로그인이 필요합니다.');
  }

  private async getFolders(webContents: Electron.WebContents): Promise<{ id: string, name: string }[]> {
    const response = await webContents.executeJavaScript(
      //language-js
      `__Bridge.fetch({
        method: 'GET',
        url: 'https://www.google.com/locationhistory/preview/mas?authuser=0&hl=ko&gl=kr&pb=!2m3!1s_jFyZufrE6LJ0-kPrue66As!7e81!15i17409!7m1!1i50!12m1!1i50!15m1!1i50!23m1!1i50!24m1!1i50!38m1!1i50',
      }).then(r => r.data);`,
    )
    const parsedFolderList: unknown[] = this.parseResponse(response)[29][0]
    const folderList = parsedFolderList.map((listItem: unknown[][]) => ({
      id: listItem[0][1] as string,
      name: listItem[1] as unknown as string,
    })).filter(item => item.id); // 속한 아이템 개수가 0개면 id가 없기에 필터링
    if (folderList.length <= 0) throw new Error('가져올 데이터가 없습니다.');
    return folderList;
  }

  private async getItemsBelongToFolder(webContents: Electron.WebContents, folderId: string): Promise<FavoriteItem[]> {
    const itemsResponse = await webContents.executeJavaScript(
      //language-js
      `__Bridge.fetch({
        method: 'GET',
        url: 'https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=ko&gl=kr&pb=!1m4!1s${folderId}!2e2!3m1!1e1!2e2!3e2!4i500!6m3!1sYityZrG1NOvg2roPxLGTiAg!7e81!28e2!16b1',
      }).then(r => r.data);`,
    )
    const parsedItems: unknown[] = this.parseResponse(itemsResponse)[0][8] || [];
    const items = parsedItems.map((item: any[]) => {
      const latLng = { lat: item[1][5][2], lng: item[1][5][3] };
      const isInKorea = this.isInKorea(latLng);
      if (!isInKorea) return;
      const favoriteItem: FavoriteItem = {
        name: item[2],
        description: item[3],
        latLng,
      }
      return favoriteItem;
    }).filter(Boolean);
    return items;
  }

  private parseResponse(responseText: string) {
    return JSON.parse(responseText.replace(")]}'\n", ''))
  }

  // 대한민국에 속한 위경도 인지 체크
  private isInKorea(latLng: FavoriteItem['latLng']) {
    const minLat = 33.0;
    const maxLat = 38.6;
    const minLng = 124.0;
    const maxLng = 132.0;
    return latLng.lat >= minLat && latLng.lat <= maxLat && latLng.lng >= minLng && latLng.lng <= maxLng;
  }
}