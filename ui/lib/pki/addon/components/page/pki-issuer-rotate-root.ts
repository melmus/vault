import Component from '@glimmer/component';
import { inject as service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { parseCertificate } from 'vault/utils/parse-pki-cert';
import camelizeKeys from 'vault/utils/camelize-object-keys';
import { waitFor } from '@ember/test-waiters';
import { task } from 'ember-concurrency';
import errorMessage from 'vault/utils/error-message';
// TYPES
import Store from '@ember-data/store';
import Router from '@ember/routing/router';
import FlashMessageService from 'vault/services/flash-messages';
import SecretMountPath from 'vault/services/secret-mount-path';
import PkiIssuerModel from 'vault/models/pki/issuer';
import { Breadcrumb } from 'vault/vault/app-types';
import { parsedParameters } from 'vault/utils/parse-pki-cert-oids';

interface Args {
  oldRoot: PkiIssuerModel;
  breadcrumbs: Breadcrumb;
}

export default class PagePkiIssuerRotateRootComponent extends Component<Args> {
  @service declare readonly store: Store;
  @service declare readonly router: Router;
  @service declare readonly flashMessages: FlashMessageService;
  @service declare readonly secretMountPath: SecretMountPath;

  @tracked rotateForm = 'use-old-settings';
  @tracked showOldSettings = false;
  @tracked newRootModel;
  @tracked alertBanner = '';
  @tracked invalidFormAlert = '';

  constructor(owner: unknown, args: Args) {
    super(owner, args);
    const certData = parseCertificate(this.args.oldRoot.certificate);
    if (certData.parsing_errors && certData.parsing_errors.length > 0) {
      const errorMessage = certData.parsing_errors.map((e: Error) => e.message).join(', ');
      this.alertBanner = errorMessage;
    }
    this.newRootModel = this.store.createRecord('pki/action', {
      actionType: 'rotate-root',
      type: 'internal',
      ...camelizeKeys(certData), // copy old root settings over to new one
    });
  }

  get bannerType() {
    if (this.alertBanner.includes('certificate contains')) {
      return {
        title: 'Not all of the certificate values could be parsed and transfered to new root',
        type: 'warning',
      };
    }
    return { type: 'danger' };
  }

  get rotationOptions() {
    return [
      {
        key: 'use-old-settings',
        icon: 'certificate',
        label: 'Use old root settings',
        description: `Provide only a new common name and issuer name, using the old root’s settings. Selecting this option generates a root with Vault-internal key material.`,
      },
      {
        key: 'customize',
        icon: 'award',
        label: 'Customize new root certificate',
        description:
          'Generates a new self-signed CA certificate and private key. This generated root will sign its own CRL.',
      },
    ];
  }

  get pageTitle() {
    return this.newRootModel.id ? 'View issuer certificate' : 'Generate new root';
  }

  get displayFields() {
    const addKeyFields = ['privateKey', 'privateKeyType'];
    const defaultFields = [
      'certificate',
      'caChain',
      ...parsedParameters,
      'issuerId',
      'serialNumber',
      'keyId',
    ];
    return this.newRootModel.id ? [...defaultFields, ...addKeyFields] : defaultFields;
  }

  @task
  @waitFor
  *save(event: Event) {
    event.preventDefault();
    try {
      yield this.newRootModel.save({ adapterOptions: { actionType: 'rotate-root' } });
      this.flashMessages.success('Successfully generated root.');
    } catch (e) {
      this.alertBanner = errorMessage(e);
      this.invalidFormAlert = 'There was a problem generating root.';
    }
  }

  @action
  async fetchDataForDownload(format: string) {
    const endpoint = `/v1/${this.secretMountPath.currentPath}/issuer/${this.newRootModel.issuerId}/${format}`;
    const adapter = this.store.adapterFor('application');
    try {
      return adapter
        .rawRequest(endpoint, 'GET', { unauthenticated: true })
        .then(function (response: Response) {
          if (format === 'der') {
            return response.blob();
          }
          return response.text();
        });
    } catch (e) {
      return null;
    }
  }
}