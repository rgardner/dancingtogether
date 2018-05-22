import * as $ from 'jquery';

function myAlert(message: string) {
    $.Callbacks();
    alert(message);
}

myAlert('Hello, cruel world!');
