import { BaseCommand } from '@adonisjs/core/build/standalone';
import AdonisOpenapi from 'adonis-openapi';

import swagger from '../config/swagger';

export default class DocsGenerate extends BaseCommand {
  public static commandName = 'docs:generate';

  public static description = '';

  public static settings = {
    loadApp: true,

    stayAlive: false,
  };

  public async run() {
    const Router = await this.application.container.use('Adonis/Core/Route');
    Router.commit();
    await AdonisOpenapi.writeFile(await Router.toJSON(), swagger);
  }
}
