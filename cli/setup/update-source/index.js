require('colors')
const glob = require('glob')
const Fs = require('fs')
const Path = require('path')
const assert = require('assert').strict
const inquirer = require('inquirer')
const runner = require('jscodeshift/src/Runner')
const hq = require('../../../src')
const { makeObjectBullets } = require('../common')
const { inspect } = require('../../utils')
const { getLongestStringLength } = require('../../utils/text')
const { getAliases, numAliases, saveSettings } = require('../../utils/config')
const { cleanPathsInfo } = require('../../utils/paths')
const { makeChoices } = require('../../utils/inquirer')
const { para } = require('../../utils/text')
const { showConfig, checkPaths, makeItemsBullets, makePathsBullets } = require('../common')
const stats = require('./stats')

// ---------------------------------------------------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------------------------------------------------

const actions = {
  getPaths () {
    // defaults
    let folders = hq.config.baseUrl
    if (hq.settings.folders.length) {
      folders = hq.settings.folders.map(folder => {
        return folder.includes(' ')
          ? `'${folder}'`
          : folder
      }).join(' ')
    }

    // question
    return inquirer
      .prompt({
        type: 'input',
        name: 'folders',
        message: 'Folders:',
        default: folders
      })
      .then(answer => {
        // variables
        const folders = answer.folders
        const { infos, valid, input } = checkPaths(folders)

        // check paths
        if (!valid) {
          return actions.getPaths()
        }

        // continue
        answers.paths = cleanPathsInfo(infos)
      })
  },

  checkForVue () {
    // skip
    if (hq.settings.extensions) {
      return
    }

    // variables
    const paths = answers.paths.map(info => info.relPath).join('|')
    const search = `+(${paths})/**/*.vue`
    const options = {
      cwd: hq.config.rootUrl
    }

    // glob!
    return new Promise(function (resolve, reject) {
      glob(search, options, function (er, files) {
        if (files.length) {
          csOptions.extensions += ', vue'
        }
        resolve()
      })
    })
  },

  getModules () {
    // choices
    const aliases = getAliases()
    const maxLength = getLongestStringLength(aliases.keys)
    const choices = aliases.keys
      .map(key => {
        const item = aliases.get(key)
        const { alias, relPath } = item
        const label = alias + ' '.repeat(maxLength - alias.length)
        const name = label + '  ' + `- ${relPath}`.grey
        return {
          name,
          short: alias,
          value: alias,
        }
      })

    const defaults = hq.settings.modules

    // question
    return inquirer
      .prompt({
        type: 'checkbox',
        name: 'modules',
        message: `Module roots:`,
        choices: choices,
        default: defaults,
        pageSize: 20,
      })
      .then(answer => {
        answers.modules = answer.modules
          .map(answer => answer.match(/\S+/).toString())
          .map(alias => aliases.get(alias))
      })
  },

  confirmChoices () {
    if (answers.mode === 'relative') {
      console.log('Choices\n')
    }
    else {
      console.log('')
    }
    console.log(`  Paths:\n` + makePathsBullets(answers.paths))
    if (answers.modules.length) {
      console.log(`  Module roots:\n` + makeItemsBullets(answers.modules, 'alias', 'relPath'))
    }
    console.log(`  Options:\n` + makeObjectBullets({
      extensions: csOptions.extensions,
      parser: csOptions.parser || 'default',
    }))
    console.log()
  },

  saveSettings () {
    const oldSettings = {
      folders: hq.settings.folders,
      modules: hq.settings.modules,
    }
    const newSettings = {
      folders: answers.paths.map(path => path.relPath),
      modules: answers.modules.map(alias => alias.alias),
    }
    // inspect({ oldSettings, newSettings })

    try {
      assert.deepEqual(oldSettings, newSettings)
    } catch (err) {
      return inquirer
        .prompt({
          type: 'confirm',
          name: 'save',
          message: 'Save updated choices?',
        })
        .then(answer => {
          if (answer.save) {
            saveSettings(newSettings)
          }
        })
    }
  },

  getAction () {
    const choices = {
      config: 'Show config',
      restart: 'Change settings',
      preview: 'Preview updates',
      proceed: 'Update files ' + '- no further confirmation!'.red,
      back: 'Back',
    }
    return inquirer
      .prompt({
        type: 'list',
        name: 'action',
        message: `Next step:`,
        choices: makeChoices(choices),
        default: choices.preview,
      })
      .then(answer => {
        const action = answer.action
        if (action === choices.back) {
          return
        }

        if (action === choices.config) {
          showConfig()
          return actions.getAction()
        }

        if (action === choices.restart) {
          return updateSource()
        }

        const dry = action === choices.preview
        return actions.process(dry)
      })
  },

  process (dry = true) {
    // aliases
    const aliases = getAliases()

    // paths
    const paths = answers.paths
      .filter(config => config.valid)
      .map(config => config.absPath)

    // modules
    const modules = answers.modules
      .map(module => module.alias)

    // options
    const options = {
      ...csOptions,
      mode: answers.mode,
      dry,
    }

    // debug
    // inspect({ paths, modules, extensions })
    // inspect({ options: csOptions, paths, aliases })

    // track updated
    stats.reset()

    // do it
    if (aliases.keys.length) {
      console.log()
      const file = __dirname + '/transformer.js'
      return runner
        .run(file, paths, { ...options, aliases, modules })
        .then(results => {
          stats.present(results)
          return actions.getAction()
        })
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------------------------------------------------

function getCsOptions () {
  // language
  const language = Path.basename(hq.settings.configFile).slice(0, 2)

  // parser
  const parser = Fs.existsSync('.flowconfig')
    ? 'flow'
    : language === 'ts'
      ? 'tsx'
      : undefined

  // extensions
  const defaultExtensions = language === 'ts'
    ? 'ts js tsx jsx'
    : 'js jsx'
  const extensions = (hq.settings.extensions || defaultExtensions)
    .match(/\w+/g)
    .join(', ')

  // TODO add options to
  // - ignore folders (node, vendor, etc)
  // - force conversion to aliases ?

  /**
   * @typedef {object} Options
   */
  return {
    dry: true,
    silent: true,
    verbose: 0,
    runInBand: true,
    ignorePattern: 'node_modules/*',
    extensions,
    parser,
  }
}

/**
 * @returns {SourceAnswers}
 */
function getAnswers () {
  /**
   * @typedef   {object}      SourceAnswers
   * @property  {PathInfo[]}  paths
   * @property  {Alias[]}     modules
   * @property  {string}      mode
   */
  return {
    paths: [],
    modules: [],
    mode: 'aliased',
  }
}

/**
 * @type {SourceAnswers}
 */
let answers

/**
 * Options for JSCodeShift
 *
 * Need to generate these when loading, and before processing:
 *
 * - in case anything has changed
 * - because they are needed in the "confirm" step
 */
let csOptions

// main function
function updateSource (toAliases = true) {
  // setup
  hq.load()
  answers = getAnswers()
  csOptions = getCsOptions()

  // check
  if (!numAliases()) {
    para('No aliases configured: skipping source code update!'.red)
    return
  }

  // actions
  if (toAliases) {
    return Promise.resolve()
      .then(actions.getPaths)
      .then(actions.checkForVue)
      .then(actions.getModules)
      .then(actions.confirmChoices)
      .then(actions.saveSettings)
      .then(actions.getAction)
  }

  else {
    answers.mode = 'relative'
    return Promise.resolve()
      .then(actions.getPaths)
      .then(actions.checkForVue)
      .then(actions.confirmChoices)
      .then(actions.getAction)
  }
}

module.exports = {
  updateSource,
  getAliases,
}
