{
    'name': 'Restore Classic Form Edit Button',
    'version': '19.0.1.1.0',
    'author': 'hamzbond',
    'maintainer': 'hamzbond',
    'summary': 'Restores the classic Edit button in form views, allowing users to switch between read-only and edit modes.',
    'description': """
        This module restores the classic Edit button in form views, allowing users to switch between read-only and edit modes. It provides a familiar interface for users who prefer the traditional form editing experience.
    """,
    'category': 'Technical',
    'support': 'hamzbond@gmail.com',
    'depends': [
        'base', 
        'web'
    ],
    'assets': {
        'web.assets_backend': [
            'odoo_classic_edit_button/static/src/xml/form_view.xml',
            'odoo_classic_edit_button/static/src/js/form_controller_patch.js',
            'odoo_classic_edit_button/static/src/css/form_controller.css',
        ],
    },
    'images': [
        'static/description/banner.png',
    ],
    'website': 'https://www.hamzbond.github.io/',
    'installable': True,
    'auto_install': False,
    'license': 'AGPL-3',

}
