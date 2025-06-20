import { BaseCommand } from '@adonisjs/core/ace';
import { CommandOptions } from '@adonisjs/core/types/ace';
import AdonisOpenapi from 'adonis-openapi';

import swagger from '#config/swagger';

export default class DocsGenerate extends BaseCommand {
  static commandName = 'docs:generate';

  static options: CommandOptions = {
    startApp: true,
    allowUnknownFlags: false,
    staysAlive: false,
  };

  async run() {
    const Router = await this.app.container.make('router');
    Router.commit();
    await AdonisOpenapi.default.writeFile(Router.toJSON(), swagger);
  }
}
