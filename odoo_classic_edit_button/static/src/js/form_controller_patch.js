/** @odoo-module **/

import { FormController } from "@web/views/form/form_controller";
import { patch } from "@web/core/utils/patch";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { _t } from "@web/core/l10n/translation";
import { FetchRecordError } from "@web/model/relational_model/errors";
import { executeButtonCallback } from "@web/views/view_button/view_button_hook";
import { onMounted } from "@odoo/owl";
import { exprToBoolean } from "@web/core/utils/strings";

patch(FormController.prototype, {
    setup() {
        super.setup(...arguments);
        
        // JURUS AUTO-KLIK CANCEL
        onMounted(() => {
            if (
                !this._classicEditRequested && 
                this.canEdit && 
                this.model.root && 
                !this.model.root.isNew &&
                !this.env.inDialog && 
                !this.hasStandaloneFooter()
            ) {
                this.model.root.switchMode("readonly");
            }
        });
    },

    _classicEditRequested: false,
    _allowManualSave: false, // Flag untuk membatasi save hanya dari aksi manual

    get modelParams() {
        const params = super.modelParams;
        
        if (this.env.inDialog || this.hasStandaloneFooter()) {
            return params;
        }

        if (this.canEdit && params.config.resId) {
            params.config.mode = "edit";
        }
        return params;
    },

    hasStandaloneFooter() {
        if (!this.env.inDialog) {
            return false;
        }
        const footer = this.props.archInfo.xmlDoc.querySelector("footer:not(field footer)");
        if (!footer) {
            return false;
        }
        const replace = footer.getAttribute("replace");
        return !(replace && !exprToBoolean(replace));
    },

    async editRecord() {
        this._classicEditRequested = true;
        await this.model.root.switchMode("edit");
    },

    // Cegah autosave background / idle / click-outside jika bukan di dialog
    async save(params = {}) {
        if (this.env.inDialog || this.hasStandaloneFooter() || this._allowManualSave) {
            return super.save(...arguments);
        }
        // Tolak / abaikan autosave otomatis dari useAutosave bawaan Odoo 19
        return false;
    },

    saveButtonClicked(params = {}) {
        const isDirtyCheck = async () => {
            const dirty = await this.model.root.isDirty();
            
            if (!dirty && !this.model.root.isNew) {
                this._classicEditRequested = false;
                return this.model.root.switchMode("readonly");
            }
            
            // Beri izin save manual
            this._allowManualSave = true;
            let saved = false;
            try {
                saved = await this.save(params);
            } finally {
                this._allowManualSave = false;
            }

            if (saved !== false) {
                this._classicEditRequested = false;
                await this.model.root.switchMode("readonly");
            }
            return saved;
        };
        
        return executeButtonCallback(this.ui.activeElement, isDirtyCheck);
    },

    async discard() {
        this._classicEditRequested = false;
        if (this.props && this.props.discardRecord) { 
            this.props.discardRecord(this.model.root);
            return;
        }
        await this.model.root.discard();
        if (this.props && this.props.onDiscard) {
            this.props.onDiscard(this.model.root);
        }
        
        if (this.env.inDialog) {
            await this.env.dialogData.close();
        } else if (this.model.root.isNew) {
            this.env.config.historyBack();
        } else {
            await this.model.root.switchMode("readonly");
        }
    },

    async beforeLeave({ forceLeave } = {}) {
        if (!this.model.root.isInEdition || forceLeave) {
            return;
        }
        const dirty = await this.model.root.isDirty();
        if (!dirty) {
            return;
        }
        
        return new Promise((resolve) => {
            this.dialogService.add(ConfirmationDialog, {
                title: _t("Unsaved changes"),
                body: _t("If you leave now, your changes will be lost. Are you sure you want to continue?"),
                confirmLabel: _t("Discard changes"),
                cancelLabel: _t("Stay on this page"),
                confirm: async () => {
                    this._classicEditRequested = false;
                    await this.model.root.discard();
                    resolve();
                },
                cancel: () => resolve(false),
            });
        });
    },

    beforeUnload(ev) {
        if (this.model.root.isInEdition && this.model.root.dirty) {
            ev.preventDefault();
            ev.returnValue = "";
        }
    },

    async onPagerUpdate({ offset, resIds }) {
        const dirty = await this.model.root.isDirty();
        try {
            if (dirty) {
                this._allowManualSave = true;
                try {
                    await this.model.root.save({
                        onError: (error, options) => this.onSaveError(error, options, true),
                        nextId: resIds[offset],
                    });
                } finally {
                    this._allowManualSave = false;
                }
            } else {
                await this.model.load({ resId: resIds[offset] });
            }
        } catch (e) {
            if (e instanceof FetchRecordError) {
                this.model.load({
                    resIds: this.model.config.resIds.filter((id) => !e.resIds.includes(id)),
                });
            }
            throw e;
        }
        
        this._classicEditRequested = false;
        await this.model.root.switchMode("readonly");
    },
});